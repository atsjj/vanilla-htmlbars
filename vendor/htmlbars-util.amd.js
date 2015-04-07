define("htmlbars-util",
  ["./htmlbars-util/safe-string","./htmlbars-util/handlebars/utils","./htmlbars-util/namespaces","./htmlbars-util/morph-utils","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __exports__) {
    "use strict";
    var SafeString = __dependency1__["default"];
    var escapeExpression = __dependency2__.escapeExpression;
    var getAttrNamespace = __dependency3__.getAttrNamespace;
    var validateChildMorphs = __dependency4__.validateChildMorphs;
    var linkParams = __dependency4__.linkParams;
    var dump = __dependency4__.dump;

    __exports__.SafeString = SafeString;
    __exports__.escapeExpression = escapeExpression;
    __exports__.getAttrNamespace = getAttrNamespace;
    __exports__.validateChildMorphs = validateChildMorphs;
    __exports__.linkParams = linkParams;
    __exports__.dump = dump;
  });
define("htmlbars-util/array-utils",
  ["exports"],
  function(__exports__) {
    "use strict";
    function forEach(array, callback, binding) {
      var i, l;
      if (binding === undefined) {
        for (i = 0, l = array.length; i < l; i++) {
          callback(array[i], i, array);
        }
      } else {
        for (i = 0, l = array.length; i < l; i++) {
          callback.call(binding, array[i], i, array);
        }
      }
    }

    __exports__.forEach = forEach;function map(array, callback) {
      var output = [];
      var i, l;

      for (i = 0, l = array.length; i < l; i++) {
        output.push(callback(array[i], i, array));
      }

      return output;
    }

    __exports__.map = map;var getIdx;
    if (Array.prototype.indexOf) {
      getIdx = function(array, obj, from){
        return array.indexOf(obj, from);
      };
    } else {
      getIdx = function(array, obj, from) {
        if (from === undefined || from === null) {
          from = 0;
        } else if (from < 0) {
          from = Math.max(0, array.length + from);
        }
        for (var i = from, l= array.length; i < l; i++) {
          if (array[i] === obj) {
            return i;
          }
        }
        return -1;
      };
    }

    var indexOfArray = getIdx;
    __exports__.indexOfArray = indexOfArray;
  });
define("htmlbars-util/handlebars/safe-string",
  ["exports"],
  function(__exports__) {
    "use strict";
    // Build out our basic SafeString type
    function SafeString(string) {
      this.string = string;
    }

    SafeString.prototype.toString = SafeString.prototype.toHTML = function() {
      return "" + this.string;
    };

    __exports__["default"] = SafeString;
  });
define("htmlbars-util/handlebars/utils",
  ["./safe-string","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    /*jshint -W004 */
    var SafeString = __dependency1__["default"];

    var escape = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#x27;",
      "`": "&#x60;"
    };

    var badChars = /[&<>"'`]/g;
    var possible = /[&<>"'`]/;

    function escapeChar(chr) {
      return escape[chr];
    }

    function extend(obj /* , ...source */) {
      for (var i = 1; i < arguments.length; i++) {
        for (var key in arguments[i]) {
          if (Object.prototype.hasOwnProperty.call(arguments[i], key)) {
            obj[key] = arguments[i][key];
          }
        }
      }

      return obj;
    }

    __exports__.extend = extend;var toString = Object.prototype.toString;
    __exports__.toString = toString;
    // Sourced from lodash
    // https://github.com/bestiejs/lodash/blob/master/LICENSE.txt
    var isFunction = function(value) {
      return typeof value === 'function';
    };
    // fallback for older versions of Chrome and Safari
    /* istanbul ignore next */
    if (isFunction(/x/)) {
      isFunction = function(value) {
        return typeof value === 'function' && toString.call(value) === '[object Function]';
      };
    }
    var isFunction;
    __exports__.isFunction = isFunction;
    /* istanbul ignore next */
    var isArray = Array.isArray || function(value) {
      return (value && typeof value === 'object') ? toString.call(value) === '[object Array]' : false;
    };
    __exports__.isArray = isArray;

    function escapeExpression(string) {
      // don't escape SafeStrings, since they're already safe
      if (string && string.toHTML) {
        return string.toHTML();
      } else if (string == null) {
        return "";
      } else if (!string) {
        return string + '';
      }

      // Force a string conversion as this will be done by the append regardless and
      // the regex test will do this transparently behind the scenes, causing issues if
      // an object's to string has escaped characters in it.
      string = "" + string;

      if(!possible.test(string)) { return string; }
      return string.replace(badChars, escapeChar);
    }

    __exports__.escapeExpression = escapeExpression;function isEmpty(value) {
      if (!value && value !== 0) {
        return true;
      } else if (isArray(value) && value.length === 0) {
        return true;
      } else {
        return false;
      }
    }

    __exports__.isEmpty = isEmpty;function appendContextPath(contextPath, id) {
      return (contextPath ? contextPath + '.' : '') + id;
    }

    __exports__.appendContextPath = appendContextPath;
  });
define("htmlbars-util/morph-utils",
  ["exports"],
  function(__exports__) {
    "use strict";
    /*globals console*/

    function visitChildren(nodes, callback) {
      if (!nodes || nodes.length === 0) { return; }

      nodes = nodes.slice();

      while (nodes.length) {
        var node = nodes.pop();
        callback(node);

        if (node.childNodes) {
          nodes.push.apply(nodes, node.childNodes);
        } else if (node.firstChildMorph) {
          var current = node.firstChildMorph;

          while (current) {
            nodes.push(current);
            current = current.nextMorph;
          }
        } else if (node.morphList) {
          nodes.push(node.morphList);
        }
      }
    }

    __exports__.visitChildren = visitChildren;function validateChildMorphs(env, morph, visitor) {
      var morphList = morph.morphList;
      if (morph.morphList) {
        var current = morphList.firstChildMorph;

        while (current) {
          var next = current.nextMorph;
          validateChildMorphs(env, current, visitor);
          current = next;
        }
      } else if (morph.lastResult) {
        morph.lastResult.revalidateWith(env, undefined, undefined, undefined, visitor);
      } else if (morph.childNodes) {
        // This means that the childNodes were wired up manually
        for (var i=0, l=morph.childNodes.length; i<l; i++) {
          validateChildMorphs(env, morph.childNodes[i], visitor);
        }
      }
    }

    __exports__.validateChildMorphs = validateChildMorphs;function linkParams(env, scope, morph, path, params, hash) {
      if (morph.linkedParams) {
        return;
      }

      if (env.hooks.linkRenderNode(morph, env, scope, path, params, hash)) {
        morph.linkedParams = { params: params, hash: hash };
      }
    }

    __exports__.linkParams = linkParams;function dump(node) {
      console.group(node, node.isDirty);

      if (node.childNodes) {
        map(node.childNodes, dump);
      } else if (node.firstChildMorph) {
        var current = node.firstChildMorph;

        while (current) {
          dump(current);
          current = current.nextMorph;
        }
      } else if (node.morphList) {
        dump(node.morphList);
      }

      console.groupEnd();
    }

    __exports__.dump = dump;function map(nodes, cb) {
      for (var i=0, l=nodes.length; i<l; i++) {
        cb(nodes[i]);
      }
    }
  });
define("htmlbars-util/namespaces",
  ["exports"],
  function(__exports__) {
    "use strict";
    // ref http://dev.w3.org/html5/spec-LC/namespaces.html
    var defaultNamespaces = {
      html: 'http://www.w3.org/1999/xhtml',
      mathml: 'http://www.w3.org/1998/Math/MathML',
      svg: 'http://www.w3.org/2000/svg',
      xlink: 'http://www.w3.org/1999/xlink',
      xml: 'http://www.w3.org/XML/1998/namespace'
    };

    function getAttrNamespace(attrName) {
      var namespace;

      var colonIndex = attrName.indexOf(':');
      if (colonIndex !== -1) {
        var prefix = attrName.slice(0, colonIndex);
        namespace = defaultNamespaces[prefix];
      }

      return namespace || null;
    }

    __exports__.getAttrNamespace = getAttrNamespace;
  });
define("htmlbars-util/object-utils",
  ["exports"],
  function(__exports__) {
    "use strict";
    function merge(options, defaults) {
      for (var prop in defaults) {
        if (options.hasOwnProperty(prop)) { continue; }
        options[prop] = defaults[prop];
      }
      return options;
    }

    __exports__.merge = merge;// IE8 does not have Object.create, so use a polyfill if needed.
    // Polyfill based on Mozilla's (MDN)
    function createObject(obj) {
      if (typeof Object.create === 'function') {
        return Object.create(obj);
      } else {
        var Temp = function() {};
        Temp.prototype = obj;
        return new Temp();
      }
    }

    __exports__.createObject = createObject;function objectKeys(obj) {
      if (typeof Object.keys === 'function') {
        return Object.keys(obj);
      } else {
        return legacyKeys(obj);
      }
    }

    __exports__.objectKeys = objectKeys;function shallowCopy(obj) {
      return merge({}, obj);
    }

    __exports__.shallowCopy = shallowCopy;function legacyKeys(obj) {
      var keys = [];

      for (var prop in obj)  {
        if (obj.hasOwnProperty(prop)) {
          keys.push(prop);
        }
      }

      return keys;
    }

    function keySet(obj) {
      var set = {};

      for (var prop in obj) {
        if (obj.hasOwnProperty(prop)) {
          set[prop] = true;
        }
      }

      return set;
    }

    __exports__.keySet = keySet;function keyLength(obj) {
      var count = 0;

      for (var prop in obj) {
        if (obj.hasOwnProperty(prop)) {
          count++;
        }
      }

      return count;
    }

    __exports__.keyLength = keyLength;
  });
define("htmlbars-util/quoting",
  ["exports"],
  function(__exports__) {
    "use strict";
    function escapeString(str) {
      str = str.replace(/\\/g, "\\\\");
      str = str.replace(/"/g, '\\"');
      str = str.replace(/\n/g, "\\n");
      return str;
    }

    __exports__.escapeString = escapeString;

    function string(str) {
      return '"' + escapeString(str) + '"';
    }

    __exports__.string = string;

    function array(a) {
      return "[" + a + "]";
    }

    __exports__.array = array;

    function hash(pairs) {
      return "{" + pairs.join(", ") + "}";
    }

    __exports__.hash = hash;function repeat(chars, times) {
      var str = "";
      while (times--) {
        str += chars;
      }
      return str;
    }

    __exports__.repeat = repeat;
  });
define("htmlbars-util/safe-string",
  ["./handlebars/safe-string","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var SafeString = __dependency1__["default"];

    __exports__["default"] = SafeString;
  });
define("htmlbars-util/template-utils",
  ["../htmlbars-util/morph-utils","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var visitChildren = __dependency1__.visitChildren;

    function blockFor(render, template, blockOptions) {
      return function(env, blockArguments, renderNode, parentScope, visitor) {
        if (renderNode.lastResult) {
          renderNode.lastResult.revalidateWith(env, undefined, undefined, blockArguments, visitor);
        } else {
          var options = { renderState: { morphListStart: null, clearMorph: renderNode, shadowOptions: null } };

          var scope = blockOptions.scope;
          var shadowScope = scope ? env.hooks.createChildScope(scope) : env.hooks.createFreshScope();

          env.hooks.bindShadowScope(env, parentScope, shadowScope, blockOptions.options);

          if (blockOptions.self !== undefined) {
            env.hooks.bindSelf(env, shadowScope, blockOptions.self);
          }

          env.hooks.bindBlock(env, shadowScope, blockOptions.yieldTo);

          renderAndCleanup(renderNode, env, options, null, function() {
            options.renderState.clearMorph = null;
            render(template, env, shadowScope, { renderNode: renderNode, blockArguments: blockArguments });
          });
        }
      };
    }

    __exports__.blockFor = blockFor;function renderAndCleanup(morph, env, options, shadowOptions, callback) {
      options.renderState.shadowOptions = shadowOptions;
      callback(options);

      var item = options.renderState.morphListStart;
      var toClear = options.renderState.clearMorph;
      var morphMap = morph.morphMap;

      while (item) {
        var next = item.nextMorph;
        delete morphMap[item.key];
        clearMorph(item, env, true);
        item.destroy();
        item = next;
      }

      if (toClear) {
        if (Object.prototype.toString.call(toClear) === '[object Array]') {
          for (var i=0, l=toClear.length; i<l; i++) {
            clearMorph(toClear[i], env);
          }
        } else {
          clearMorph(toClear, env);
        }
      }
    }

    __exports__.renderAndCleanup = renderAndCleanup;function clearMorph(morph, env, destroySelf) {
      var cleanup = env.hooks.cleanupRenderNode;
      var destroy = env.hooks.destroyRenderNode;
      var willCleanup = env.hooks.willCleanupTree;
      var didCleanup = env.hooks.didCleanupTree;

      function destroyNode(node) {
        if (cleanup) { cleanup(node); }
        if (destroy) { destroy(node); }
      }

      if (willCleanup) { willCleanup(env, morph, destroySelf); }
      if (cleanup) { cleanup(morph); }
      if (destroySelf && destroy) { destroy(morph); }

      visitChildren(morph.childNodes, destroyNode);

      // TODO: Deal with logical children that are not in the DOM tree
      morph.clear();
      if (didCleanup) { didCleanup(env, morph, destroySelf); }

      morph.lastResult = null;
      morph.lastYielded = null;
      morph.childNodes = null;
    }

    __exports__.clearMorph = clearMorph;
  });