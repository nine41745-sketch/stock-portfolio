const original = require('./react-legacy-plugin.cjs').rules['no-deprecated'];
module.exports = {rules:{'namespace-deprecated':{
 meta:original.meta,
 create(context){
  const source = context.sourceCode;
  const imports = source.ast.body.filter(n=>n.type==='ImportDeclaration' && n.importKind!=='type' && n.source.value==='react').flatMap(n=>n.specifiers.filter(s=>s.type==='ImportNamespaceSpecifier'||s.type==='ImportDefaultSpecifier').map(s=>s.local.name));
  const existing = context.settings?.react?.pragma || 'React';
  const listeners = {};
  for(const name of new Set(imports.filter(n=>n!==existing))){
    const matches = node => {
      if(!node || typeof node!=='object') return false;
      const seen=new Set();
      function walk(n){
        if(!n || typeof n!=='object' || seen.has(n))return false; seen.add(n);
        if(n.type==='Identifier' && n.name===name){
          let scope=source.getScope(n);
          while(scope){const v=scope.set.get(name);if(v)return v.defs.some(d=>d.type==='ImportBinding'&&d.parent?.source?.value==='react');scope=scope.upper;}
        }
        for(const [k,v] of Object.entries(n)){if(k==='parent'||k==='loc'||k==='range'||k==='tokens'||k==='comments')continue;if(Array.isArray(v)){if(v.some(walk))return true;}else if(v&&typeof v==='object'&&walk(v))return true;}
        return false;
      }return walk(node);
    };
    const child=Object.create(context);
    Object.defineProperties(child,{
      settings:{value:{...context.settings,react:{...context.settings?.react,pragma:name}}},
      report:{value:(...args)=>{const n=args[0]?.node||args[0];if(matches(n))context.report(...args)}}
    });
    const extra=original.create(child);
    for(const [event,fn] of Object.entries(extra)){(listeners[event]??=[]).push(fn);}
  }
  return Object.fromEntries(Object.entries(listeners).map(([event,fns])=>[event,(...args)=>{for(const fn of fns)fn(...args)}]));
 }
}}};

