'use strict';

const MODULE_PREFIX = new Map([
  ['react', 'React'],
  ['react-addons-perf', 'ReactPerf'],
  ['react-dom', 'ReactDOM'],
  ['react-dom/server', 'ReactDOMServer'],
]);

const DEPRECATED = new Map([
  ['React.renderComponent', ['0.12.0', 'React.render']],
  ['React.renderComponentToString', ['0.12.0', 'React.renderToString']],
  ['React.renderComponentToStaticMarkup', ['0.12.0', 'React.renderToStaticMarkup']],
  ['React.isValidComponent', ['0.12.0', 'React.isValidElement']],
  ['React.PropTypes.component', ['0.12.0', 'React.PropTypes.element']],
  ['React.PropTypes.renderable', ['0.12.0', 'React.PropTypes.node']],
  ['React.isValidClass', ['0.12.0']],
  ['this.transferPropsTo', ['0.12.0', 'spread operator ({...})']],
  ['React.addons.classSet', ['0.13.0', 'the npm module classnames']],
  ['React.addons.cloneWithProps', ['0.13.0', 'React.cloneElement']],
  ['React.render', ['0.14.0', 'ReactDOM.render']],
  ['React.unmountComponentAtNode', ['0.14.0', 'ReactDOM.unmountComponentAtNode']],
  ['React.findDOMNode', ['0.14.0', 'ReactDOM.findDOMNode']],
  ['React.renderToString', ['0.14.0', 'ReactDOMServer.renderToString']],
  ['React.renderToStaticMarkup', ['0.14.0', 'ReactDOMServer.renderToStaticMarkup']],
  ['React.addons.LinkedStateMixin', ['15.0.0']],
  ['ReactPerf.printDOM', ['15.0.0', 'ReactPerf.printOperations']],
  ['Perf.printDOM', ['15.0.0', 'Perf.printOperations']],
  ['ReactPerf.getMeasurementsSummaryMap', ['15.0.0', 'ReactPerf.getWasted']],
  ['Perf.getMeasurementsSummaryMap', ['15.0.0', 'Perf.getWasted']],
  ['React.createClass', ['15.5.0', 'the npm module create-react-class']],
  ['React.addons.TestUtils', ['15.5.0', 'ReactDOM.TestUtils']],
  ['React.PropTypes', ['15.5.0', 'the npm module prop-types']],
  ['React.DOM', ['15.6.0', 'the npm module react-dom-factories']],
  ['componentWillMount', ['16.9.0', 'UNSAFE_componentWillMount']],
  ['componentWillReceiveProps', ['16.9.0', 'UNSAFE_componentWillReceiveProps']],
  ['componentWillUpdate', ['16.9.0', 'UNSAFE_componentWillUpdate']],
  ['ReactDOM.render', ['18.0.0', 'createRoot', 'https://reactjs.org/link/switch-to-createroot']],
  ['ReactDOM.hydrate', ['18.0.0', 'hydrateRoot', 'https://reactjs.org/link/switch-to-createroot']],
  ['ReactDOM.unmountComponentAtNode', ['18.0.0', 'root.unmount']],
  ['ReactDOMServer.renderToNodeStream', ['18.0.0', 'renderToPipeableStream']],
]);

const lifecycleNames = new Set([
  'componentWillMount',
  'componentWillReceiveProps',
  'componentWillUpdate',
]);

const rule = {
  meta: {
    docs: { description: 'Disallow deprecated React APIs' },
    messages: {
      deprecated: '{{oldMethod}} is deprecated since React {{version}}{{newMethod}}{{refs}}',
    },
    schema: [],
  },
  create(context) {
    const source = context.sourceCode;
    const aliases = new Map();
    const pragma = context.settings?.react?.pragma || 'React';

    function staticName(node) {
      if (!node) return null;
      if (node.type === 'Identifier') return node.name;
      if (node.type === 'PrivateIdentifier') return `#${node.name}`;
      if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
      return null;
    }

    function chain(node) {
      if (!node) return [];
      if (node.type === 'Identifier') return [node.name];
      if (node.type === 'ThisExpression') return ['this'];
      if (node.type === 'MemberExpression') {
        const left = chain(node.object);
        const right = staticName(node.property);
        return right === null ? [] : [...left, right];
      }
      return [];
    }

    function bindingMatches(identifier, moduleName) {
      if (!identifier || identifier.type !== 'Identifier') return false;
      const scope = source.getScope(identifier);
      let current = scope;
      while (current) {
        const variable = current.set.get(identifier.name);
        if (variable) {
          return variable.defs.some((definition) => {
            if (definition.type === 'ImportBinding') {
              return definition.parent?.source?.value === moduleName;
            }
            if (definition.type === 'Variable' && definition.node?.init?.type === 'CallExpression') {
              const call = definition.node.init;
              return call.callee?.type === 'Identifier'
                && call.callee.name === 'require'
                && call.arguments?.[0]?.value === moduleName;
            }
            return false;
          });
        }
        current = current.upper;
      }
      return false;
    }

    function canonicalPrefix(base, identifier) {
      if (base === pragma) return 'React';
      if (base === 'ReactDOM' || base === 'ReactDOMServer' || base === 'ReactPerf' || base === 'Perf') return base;
      const moduleName = aliases.get(base);
      if (!moduleName || !bindingMatches(identifier, moduleName)) return null;
      return MODULE_PREFIX.get(moduleName) || null;
    }

    function reportDeprecated(node, canonicalName) {
      const detail = DEPRECATED.get(canonicalName);
      if (!detail) return;
      context.report({
        node,
        messageId: 'deprecated',
        data: {
          oldMethod: canonicalName,
          version: detail[0],
          newMethod: detail[1] ? `, use ${detail[1]} instead` : '',
          refs: detail[2] ? `, see ${detail[2]}` : '',
        },
      });
    }

    function reactModuleOfRequire(node) {
      if (node?.type !== 'CallExpression'
        || node.callee?.type !== 'Identifier'
        || node.callee.name !== 'require'
        || node.arguments?.length !== 1) return null;
      const sourceName = node.arguments[0]?.value;
      return MODULE_PREFIX.has(sourceName) ? sourceName : null;
    }

    function moduleNameForExpression(node) {
      if (node?.type !== 'Identifier') return null;
      if (node.name === pragma) return 'react';
      const known = aliases.get(node.name);
      return known && bindingMatches(node, known) ? known : null;
    }

    function checkDestructuring(node, moduleName) {
      const prefix = MODULE_PREFIX.get(moduleName);
      if (!prefix || node.id?.type !== 'ObjectPattern') return;
      for (const property of node.id.properties) {
        if (!property || property.type === 'RestElement') continue;
        const name = staticName(property.key);
        if (name) reportDeprecated(property, `${prefix}.${name}`);
      }
    }

    function isReactClass(node) {
      const superClass = node.superClass;
      const parts = chain(superClass);
      if (parts.length < 2 || !['Component', 'PureComponent'].includes(parts.at(-1))) return false;
      const root = parts[0];
      if (root === pragma || root === 'React') return true;
      const moduleName = aliases.get(root);
      return moduleName === 'react' && bindingMatches(superClass.object || superClass, moduleName);
    }

    function checkClassLifecycle(node) {
      if (!isReactClass(node)) return;
      for (const member of node.body.body) {
        if (!member.static && lifecycleNames.has(staticName(member.key))) {
          reportDeprecated(member.key, staticName(member.key));
        }
      }
    }

    function isReactCreateClassObject(node) {
      const call = node.parent;
      if (call?.type !== 'CallExpression' || !call.arguments.includes(node)) return false;
      const parts = chain(call.callee);
      if (parts.length !== 2 || parts[1] !== 'createClass') return false;
      if (parts[0] === pragma || parts[0] === 'React') return true;
      const moduleName = aliases.get(parts[0]);
      return moduleName === 'react' && bindingMatches(call.callee.object, moduleName);
    }

    return {
      ImportDeclaration(node) {
        const moduleName = node.source.value;
        const prefix = MODULE_PREFIX.get(moduleName);
        if (!prefix) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier' || specifier.type === 'ImportDefaultSpecifier') {
            aliases.set(specifier.local.name, moduleName);
          } else if (specifier.type === 'ImportSpecifier') {
            const imported = staticName(specifier.imported);
            if (imported) reportDeprecated(specifier, `${prefix}.${imported}`);
          }
        }
      },
      VariableDeclarator(node) {
        const moduleName = reactModuleOfRequire(node.init)
          || moduleNameForExpression(node.init);
        if (!moduleName) return;
        if (node.id.type === 'Identifier') aliases.set(node.id.name, moduleName);
        else checkDestructuring(node, moduleName);
      },
      MemberExpression(node) {
        const parts = chain(node);
        if (parts.length < 2) return;
        const root = parts[0];
        const identifier = node.object.type === 'Identifier' ? node.object : node.object;
        const prefix = canonicalPrefix(root, identifier);
        if (prefix) reportDeprecated(node, [prefix, ...parts.slice(1)].join('.'));
        if (parts[0] === 'this' && parts.slice(1).join('.') === 'transferPropsTo') {
          reportDeprecated(node, 'this.transferPropsTo');
        }
      },
      ClassDeclaration: checkClassLifecycle,
      ClassExpression: checkClassLifecycle,
      Property(node) {
        if (!lifecycleNames.has(staticName(node.key)) || !isReactCreateClassObject(node.parent)) return;
        reportDeprecated(node.key, staticName(node.key));
      },
    };
  },
};

module.exports = { rules: { 'no-deprecated': rule } };
