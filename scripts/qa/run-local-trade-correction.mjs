import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, createWriteStream } from 'node:fs'
import { randomUUID, randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import { openLoopbackProxy } from './supabase-loopback-proxy.mjs'
import { assertLocalDockerEndpoint } from './database-lp-safety.mjs'
import { prepareCorrectionCatalog } from './correction-catalog-lifecycle.mjs'

assert.equal(process.versions.node.split('.')[0],'22')
const root=fileURLToPath(new URL('../../',import.meta.url)), out=path.join(root,'.local-artifacts/atomic-trade-correction'), run=randomUUID(), project=`stock-lp-${run.slice(0,12)}`, network=`supabase_network_${project}`
const work=path.join(out,run), cli=process.env.QA_SUPABASE_CLI_PATH
assert(cli && path.isAbsolute(cli) && existsSync(cli),'Explicit installed Supabase CLI path required; runner downloads nothing')
await mkdir(path.join(work,'supabase'),{recursive:true})
assert(!existsSync(path.join(root,'supabase/.temp/project-ref')))
for(const file of ['.env','.env.local','.env.development','.env.development.local']) assert(!existsSync(path.join(root,file)),'Environment file forbidden')
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/(SUPABASE|FINNHUB|GROQ|SEC_USER|PIN_|CRON_SECRET|VERCEL|DATABASE_URL|PGPASSWORD|DOCKER_HOST|DOCKER_CONTEXT|NODE_OPTIONS)/i.test(k)))
env.NEXT_TELEMETRY_DISABLED='1'
function command(exe,args,{cwd=root,extra={},input,timeout=180000,allowFailure=false,outputFile}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{cwd,env:{...env,...extra},windowsHide:true,stdio:['pipe','pipe','pipe']})
    let stdout='',stderr=''; const file=outputFile?createWriteStream(outputFile):null
    child.stdout.on('data',b=>{stdout+=b;file?.write(b)})
    child.stderr.on('data',b=>{stderr+=b;file?.write(b)})
    if(input)child.stdin.end(input);else child.stdin.end()
    const timer=setTimeout(()=>child.kill(),timeout)
    child.on('error',reject)
    child.on('close',code=>{clearTimeout(timer);file?.end();const result={code,stdout,stderr};
      if(code!==0&&!allowFailure)reject(new Error(`${path.basename(exe)} ${args[0]} failed (exit ${code})`));else resolve(result)})
  })
}
let endpoint, proxy, app, dbId, finishCatalog, failed=false, stage='preflight', checks=[]
const catalogProfile=process.env.QA_CORRECTION_CATALOG_PROFILE
assert(catalogProfile===undefined || catalogProfile==='1','Only the explicit local catalog QA profile is supported')
const docker=(args,options={})=>command('docker',['--host',endpoint,...args],options)
const inspect=async(id)=>JSON.parse((await docker(['inspect',id])).stdout)[0]
function assertOwned(item){assert.equal(item.Config.Labels['com.supabase.cli.project'],project);assert.deepEqual(Object.keys(item.NetworkSettings.Networks),[network])}
const pass=name=>{checks.push(name);console.log('PASS '+name)}
try {
  const candidateEndpoint=JSON.parse((await command('docker',['context','inspect'])).stdout)[0].Endpoints.docker.Host
  endpoint=assertLocalDockerEndpoint(candidateEndpoint)
  assert.equal((await command(cli,['--version'],{cwd:work})).stdout.trim(),'2.84.2')
  const ports=[]
  for(let i=0;i<4;i++){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));ports.push(s.address().port);await new Promise(r=>s.close(r))}
  assert.equal(new Set(ports).size,4)
  const [apiPort,dbPort,shadowPort,appPort]=ports
  const config=(await readFile(path.join(root,'supabase/config.toml'),'utf8'))
    .replace(/project_id = "[^"]+"/,`project_id = "${project}"`).replace('port = 54321',`port = ${apiPort}`)
    .replace('port = 54322',`port = ${dbPort}`).replace('shadow_port = 54320',`shadow_port = ${shadowPort}`).replaceAll(':3000',`:${appPort}`)
  await writeFile(path.join(work,'supabase/config.toml'),config)
  await docker(['network','create','--driver','bridge','--label',`com.supabase.cli.project=${project}`,'--label',`qa.owner.run=${run}`,
    '--opt','com.docker.network.bridge.host_binding_ipv4=127.0.0.1',network])
  proxy=await openLoopbackProxy(endpoint,{project,network})
  pass('Fresh project, pinned CLI, dedicated Docker network and loopback-enforcing proxy')
  stage='supabase-start'
  await command(cli,['start','--exclude','studio,mailpit,realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta'],
    {cwd:work,extra:{DOCKER_HOST:proxy.endpoint},timeout:300000,outputFile:path.join(work,'startup.log')})
  const ids=(await docker(['ps','-aq','--filter',`label=com.supabase.cli.project=${project}`])).stdout.trim().split(/\s+/).filter(Boolean)
  assert(ids.length>=4)
  for(const id of ids){const item=await inspect(id);assertOwned(item);for(const bindings of Object.values(item.NetworkSettings.Ports??{}))for(const binding of bindings??[])assert.equal(binding.HostIp,'127.0.0.1')
    if(item.Name===`/supabase_db_${project}`)dbId=id}
  assert(dbId)
  pass('Actual Supabase containers verified owned, unique and bound only to loopback')
  const status=(await command(cli,['status','--output','env'],{cwd:work,extra:{DOCKER_HOST:proxy.endpoint}})).stdout
  const values=Object.fromEntries(status.split(/\r?\n/).flatMap(line=>{const m=line.match(/^([A-Z_]+)="(.*)"$/);return m?[[m[1],m[2]]]:[]}))
  const api=new URL(values.API_URL), db=new URL(values.DB_URL)
  assert.equal(api.hostname,'127.0.0.1');assert.equal(api.port,String(apiPort));assert.equal(db.port,String(dbPort));assert.equal(db.hostname,'127.0.0.1')
  assert(values.ANON_KEY&&values.SERVICE_ROLE_KEY)
  const localEnv={NEXT_PUBLIC_SUPABASE_URL:api.origin,NEXT_PUBLIC_SUPABASE_ANON_KEY:values.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:values.SERVICE_ROLE_KEY,
    SUPABASE_ENCRYPTION_KEY:randomBytes(32).toString('hex'),PIN_PEPPER:randomBytes(32).toString('hex'),PIN_SESSION_SECRET:randomBytes(32).toString('hex'),
    CRON_SECRET:randomBytes(32).toString('hex'),QA_BASE_URL:`http://127.0.0.1:${appPort}`,QA_SUPABASE_API_PORT:String(apiPort),QA_APP_PORT:String(appPort),QA_DB_CONTAINER:`supabase_db_${project}`,
    DOCKER_HOST:endpoint,QA_NETWORK_GUARD_LOG:path.join(work,'network-guard.log'),NODE_OPTIONS:`--require=${path.join(root,'scripts/qa/deny-external-network.cjs')}`}
  stage='bootstrap'
  await command('C:/Program Files/Git/bin/bash.exe',['scripts/qa/bootstrap-local-supabase.sh'],{extra:localEnv,timeout:180000,outputFile:path.join(work,'bootstrap.log')})
  pass('Unchanged repository bootstrap and least-privilege verification on actual disposable Supabase')
  stage='candidate-correction-migration'
  const candidate=await readFile(path.join(root,'supabase/20261023074534_atomic_trade_correction.sql'),'utf8')
  if(catalogProfile){
    const sql=async(input,allowFailure=false)=>{
      const result=await docker(['exec','-i',dbId,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input,allowFailure:true})
      if(result.code!==0&&!allowFailure){
        await writeFile(path.join(work,'catalog-sql-failure.log'),result.stderr)
        throw new Error(result.stderr.split(/\r?\n/).filter(line=>/ERROR:|DETAIL:/.test(line)).join(' ').slice(0,1000)||'Local catalog SQL failed')
      }
      return result
    }
    finishCatalog=await prepareCorrectionCatalog({sql,candidate,endpoint,container:`supabase_db_${project}`,pass,
      fixture:await readFile(path.join(root,'scripts/qa/fixtures/production-correction-catalog.sql'),'utf8')})
    const decimalResult=await sql(await readFile(path.join(root,'scripts/qa/fixtures/correction-decimal-null.sql'),'utf8'))
    await writeFile(path.join(work,'catalog-decimal-null.log'),decimalResult.stderr)
    assert.equal((decimalResult.stderr.match(/NOTICE:  PASS /g)??[]).length,9)
    process.stdout.write(decimalResult.stderr)
    pass('Nine exact-decimal/NULL/account-deletion characterization groups passed on the scoped catalog profile')
  }else{
    await docker(['exec','-i',dbId,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:candidate,outputFile:path.join(work,'correction-migration.log')})
  }
  pass('Candidate correction migration applied only to the owned disposable database')
  stage='app-start'
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(appPort)],{cwd:root,env:{...env,...localEnv},windowsHide:true,stdio:['ignore','pipe','pipe']})
  const appLog=createWriteStream(path.join(work,'app.log'));app.stdout.pipe(appLog);app.stderr.pipe(appLog)
  let ready=false
  for(let i=0;i<90;i++){if(app.exitCode!==null)throw new Error('Isolated app exited');try{const r=await fetch(`${localEnv.QA_BASE_URL}/login`,{signal:AbortSignal.timeout(4000)});if(r.status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,1000))}
  assert(ready,'App readiness deadline exceeded')
  pass('Unchanged Next app ready with generated disposable credentials and external-network guard')
  stage='manual-ledger-browser-execution'
  const manualResult=await command(process.execPath,['scripts/qa/transactions-browser.mjs'],{extra:{...localEnv,EXECUTION_EVIDENCE_DIR:work},timeout:240000,allowFailure:true,outputFile:path.join(work,'transactions-browser.log')})
  process.stdout.write(manualResult.stdout);assert.equal(manualResult.code,0,'Manual ledger E2E failed; inspect synthetic browser evidence')
  stage='browser-execution'
  const result=await command(process.execPath,['scripts/qa/trade-correction-browser.mjs'],{extra:{...localEnv,EXECUTION_EVIDENCE_DIR:work},timeout:240000,allowFailure:true,outputFile:path.join(work,'browser.log')})
  process.stdout.write(result.stdout);assert.equal(result.code,0,'Execution E2E failed; inspect synthetic browser evidence')
  if(finishCatalog){stage='post-use-rollback';await finishCatalog()}
} catch(error){failed=true;console.log(`FAIL ${stage}: ${error.message}`)}
finally {
  try {
    if(app?.pid&&app.exitCode===null)await command('taskkill',['/PID',String(app.pid),'/T','/F'],{allowFailure:true})
    if(endpoint){
      const ids=(await docker(['ps','-aq','--filter',`label=com.supabase.cli.project=${project}`])).stdout.trim().split(/\s+/).filter(Boolean)
      for(const id of ids){const item=await inspect(id);assertOwned(item);await docker(['rm','-f',id])}
      const volumes=(await docker(['volume','ls','-q','--filter',`label=com.supabase.cli.project=${project}`])).stdout.trim().split(/\s+/).filter(Boolean)
      for(const volume of volumes){const item=JSON.parse((await docker(['volume','inspect',volume])).stdout)[0];assert.equal(item.Labels['com.supabase.cli.project'],project);assert(volume.endsWith(project));await docker(['volume','rm',volume])}
      const n=await docker(['network','inspect',network],{allowFailure:true})
      if(n.code===0){const item=JSON.parse(n.stdout)[0];assert.equal(item.Labels['qa.owner.run'],run);assert.equal(Object.keys(item.Containers??{}).length,0);await docker(['network','rm',network])}
      for(const kind of ['ps','volume','network']){
        const args=kind==='ps'?['ps','-aq']: [kind,'ls','-q'];assert.equal((await docker([...args,'--filter',`label=com.supabase.cli.project=${project}`])).stdout.trim(),'')}
      pass('Run-owned containers, volumes and network removed; empty post-cleanup inventory verified')
    }
  }catch(error){failed=true;console.log('FAIL cleanup: '+error.message)}
  await proxy?.close()
  await writeFile(path.join(work,'platform-report.json'),JSON.stringify({status:failed?'FAIL':'PASS',run,project,stage,checks,syntheticOnly:true,externalGuard:true,catalogProfile:catalogProfile?'observed-scoped-2026-10-23':'repository-bootstrap',sourceSha:(await command('git',['rev-parse','HEAD'])).stdout.trim(),dirtyTree:true},null,2))
  console.log('EVIDENCE '+work);process.exitCode=failed?1:0
}
