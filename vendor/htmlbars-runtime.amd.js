define("dom-helper",
  ["./htmlbars-runtime/morph","./morph-attr","./dom-helper/build-html-dom","./dom-helper/classes","./dom-helper/prop","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __dependency5__, __exports__) {
    "use strict";
    var Morph = __dependency1__["default"];
    var AttrMorph = __dependency2__["default"];
    var buildHTMLDOM = __dependency3__.buildHTMLDOM;
    var svgNamespace = __dependency3__.svgNamespace;
    var svgHTMLIntegrationPoints = __dependency3__.svgHTMLIntegrationPoints;
    var addClasses = __dependency4__.addClasses;
    var removeClasses = __dependency4__.removeClasses;
    var normalizeProperty = __dependency5__.normalizeProperty;
    var isAttrRemovalValue = __dependency5__.isAttrRemovalValue;

    var doc = typeof document === 'undefined' ? false : document;

    var deletesBlankTextNodes = doc && (function(document){
      var element = document.createElement('div');
      element.appendChild( document.createTextNode('') );
      var clonedElement = element.cloneNode(true);
      return clonedElement.childNodes.length === 0;
    })(doc);

    var ignoresCheckedAttribute = doc && (function(document){
      var element = document.createElement('input');
      element.setAttribute('checked', 'checked');
      var clonedElement = element.cloneNode(false);
      return !clonedElement.checked;
    })(doc);

    var canRemoveSvgViewBoxAttribute = doc && (doc.createElementNS ? (function(document){
      var element = document.createElementNS(svgNamespace, 'svg');
      element.setAttribute('viewBox', '0 0 100 100');
      element.removeAttribute('viewBox');
      return !element.getAttribute('viewBox');
    })(doc) : true);

    var canClone = doc && (function(document){
      var element = document.createElement('div');
      element.appendChild( document.createTextNode(' '));
      element.appendChild( document.createTextNode(' '));
      var clonedElement = element.cloneNode(true);
      return clonedElement.childNodes[0].nodeValue === ' ';
    })(doc);

    // This is not the namespace of the element, but of
    // the elements inside that elements.
    function interiorNamespace(element){
      if (
        element &&
        element.namespaceURI === svgNamespace &&
        !svgHTMLIntegrationPoints[element.tagName]
      ) {
        return svgNamespace;
      } else {
        return null;
      }
    }

    // The HTML spec allows for "omitted start tags". These tags are optional
    // when their intended child is the first thing in the parent tag. For
    // example, this is a tbody start tag:
    //
    // <table>
    //   <tbody>
    //     <tr>
    //
    // The tbody may be omitted, and the browser will accept and render:
    //
    // <table>
    //   <tr>
    //
    // However, the omitted start tag will still be added to the DOM. Here
    // we test the string and context to see if the browser is about to
    // perform this cleanup.
    //
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/syntax.html#optional-tags
    // describes which tags are omittable. The spec for tbody and colgroup
    // explains this behavior:
    //
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/tables.html#the-tbody-element
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/tables.html#the-colgroup-element
    //

    var omittedStartTagChildTest = /<([\w:]+)/;
    function detectOmittedStartTag(string, contextualElement){
      // Omitted start tags are only inside table tags.
      if (contextualElement.tagName === 'TABLE') {
        var omittedStartTagChildMatch = omittedStartTagChildTest.exec(string);
        if (omittedStartTagChildMatch) {
          var omittedStartTagChild = omittedStartTagChildMatch[1];
          // It is already asserted that the contextual element is a table
          // and not the proper start tag. Just see if a tag was omitted.
          return omittedStartTagChild === 'tr' ||
                 omittedStartTagChild === 'col';
        }
      }
    }

    function buildSVGDOM(html, dom){
      var div = dom.document.createElement('div');
      div.innerHTML = '<svg>'+html+'</svg>';
      return div.firstChild.childNodes;
    }

    function ElementMorph(element, dom, namespace) {
      this.element = element;
      this.dom = dom;
      this.namespace = namespace;

      this.state = {};
      this.isDirty = true;
    }

    /*
     * A class wrapping DOM functions to address environment compatibility,
     * namespaces, contextual elements for morph un-escaped content
     * insertion.
     *
     * When entering a template, a DOMHelper should be passed:
     *
     *   template(context, { hooks: hooks, dom: new DOMHelper() });
     *
     * TODO: support foreignObject as a passed contextual element. It has
     * a namespace (svg) that does not match its internal namespace
     * (xhtml).
     *
     * @class DOMHelper
     * @constructor
     * @param {HTMLDocument} _document The document DOM methods are proxied to
     */
    function DOMHelper(_document){
      this.document = _document || document;
      if (!this.document) {
        throw new Error("A document object must be passed to the DOMHelper, or available on the global scope");
      }
      this.canClone = canClone;
      this.namespace = null;
    }

    var prototype = DOMHelper.prototype;
    prototype.constructor = DOMHelper;

    prototype.getElementById = function(id, rootNode) {
      rootNode = rootNode || this.document;
      return rootNode.getElementById(id);
    };

    prototype.insertBefore = function(element, childElement, referenceChild) {
      return element.insertBefore(childElement, referenceChild);
    };

    prototype.appendChild = function(element, childElement) {
      return element.appendChild(childElement);
    };

    prototype.childAt = function(element, indices) {
      var child = element;

      for (var i = 0; i < indices.length; i++) {
        child = child.childNodes.item(indices[i]);
      }

      return child;
    };

    // Note to a Fellow Implementor:
    // Ahh, accessing a child node at an index. Seems like it should be so simple,
    // doesn't it? Unfortunately, this particular method has caused us a surprising
    // amount of pain. As you'll note below, this method has been modified to walk
    // the linked list of child nodes rather than access the child by index
    // directly, even though there are two (2) APIs in the DOM that do this for us.
    // If you're thinking to yourself, "What an oversight! What an opportunity to
    // optimize this code!" then to you I say: stop! For I have a tale to tell.
    //
    // First, this code must be compatible with simple-dom for rendering on the
    // server where there is no real DOM. Previously, we accessed a child node
    // directly via `element.childNodes[index]`. While we *could* in theory do a
    // full-fidelity simulation of a live `childNodes` array, this is slow,
    // complicated and error-prone.
    //
    // "No problem," we thought, "we'll just use the similar
    // `childNodes.item(index)` API." Then, we could just implement our own `item`
    // method in simple-dom and walk the child node linked list there, allowing
    // us to retain the performance advantages of the (surely optimized) `item()`
    // API in the browser.
    //
    // Unfortunately, an enterprising soul named Samy Alzahrani discovered that in
    // IE8, accessing an item out-of-bounds via `item()` causes an exception where
    // other browsers return null. This necessitated a... check of
    // `childNodes.length`, bringing us back around to having to support a
    // full-fidelity `childNodes` array!
    //
    // Worst of all, Kris Selden investigated how browsers are actualy implemented
    // and discovered that they're all linked lists under the hood anyway. Accessing
    // `childNodes` requires them to allocate a new live collection backed by that
    // linked list, which is itself a rather expensive operation. Our assumed
    // optimization had backfired! That is the danger of magical thinking about
    // the performance of native implementations.
    //
    // And this, my friends, is why the following implementation just walks the
    // linked list, as surprised as that may make you. Please ensure you understand
    // the above before changing this and submitting a PR.
    //
    // Tom Dale, January 18th, 2015, Portland OR
    prototype.childAtIndex = function(element, index) {
      var node = element.firstChild;

      for (var idx = 0; node && idx < index; idx++) {
        node = node.nextSibling;
      }

      return node;
    };

    prototype.appendText = function(element, text) {
      return element.appendChild(this.document.createTextNode(text));
    };

    prototype.setAttribute = function(element, name, value) {
      element.setAttribute(name, String(value));
    };

    prototype.setAttributeNS = function(element, namespace, name, value) {
      element.setAttributeNS(namespace, name, String(value));
    };

    if (canRemoveSvgViewBoxAttribute){
      prototype.removeAttribute = function(element, name) {
        element.removeAttribute(name);
      };
    } else {
      prototype.removeAttribute = function(element, name) {
        if (element.tagName === 'svg' && name === 'viewBox') {
          element.setAttribute(name, null);
        } else {
          element.removeAttribute(name);
        }
      };
    }

    prototype.setPropertyStrict = function(element, name, value) {
      element[name] = value;
    };

    prototype.setProperty = function(element, name, value, namespace) {
      var lowercaseName = name.toLowerCase();
      if (element.namespaceURI === svgNamespace || lowercaseName === 'style') {
        if (isAttrRemovalValue(value)) {
          element.removeAttribute(name);
        } else {
          if (namespace) {
            element.setAttributeNS(namespace, name, value);
          } else {
            element.setAttribute(name, value);
          }
        }
      } else {
        var normalized = normalizeProperty(element, name);
        if (normalized) {
          element[normalized] = value;
        } else {
          if (isAttrRemovalValue(value)) {
            element.removeAttribute(name);
          } else {
            if (namespace && element.setAttributeNS) {
              element.setAttributeNS(namespace, name, value);
            } else {
              element.setAttribute(name, value);
            }
          }
        }
      }
    };

    if (doc && doc.createElementNS) {
      // Only opt into namespace detection if a contextualElement
      // is passed.
      prototype.createElement = function(tagName, contextualElement) {
        var namespace = this.namespace;
        if (contextualElement) {
          if (tagName === 'svg') {
            namespace = svgNamespace;
          } else {
            namespace = interiorNamespace(contextualElement);
          }
        }
        if (namespace) {
          return this.document.createElementNS(namespace, tagName);
        } else {
          return this.document.createElement(tagName);
        }
      };
      prototype.setAttributeNS = function(element, namespace, name, value) {
        element.setAttributeNS(namespace, name, String(value));
      };
    } else {
      prototype.createElement = function(tagName) {
        return this.document.createElement(tagName);
      };
      prototype.setAttributeNS = function(element, namespace, name, value) {
        element.setAttribute(name, String(value));
      };
    }

    prototype.addClasses = addClasses;
    prototype.removeClasses = removeClasses;

    prototype.setNamespace = function(ns) {
      this.namespace = ns;
    };

    prototype.detectNamespace = function(element) {
      this.namespace = interiorNamespace(element);
    };

    prototype.createDocumentFragment = function(){
      return this.document.createDocumentFragment();
    };

    prototype.createTextNode = function(text){
      return this.document.createTextNode(text);
    };

    prototype.createComment = function(text){
      return this.document.createComment(text);
    };

    prototype.repairClonedNode = function(element, blankChildTextNodes, isChecked){
      if (deletesBlankTextNodes && blankChildTextNodes.length > 0) {
        for (var i=0, len=blankChildTextNodes.length;i<len;i++){
          var textNode = this.document.createTextNode(''),
              offset = blankChildTextNodes[i],
              before = this.childAtIndex(element, offset);
          if (before) {
            element.insertBefore(textNode, before);
          } else {
            element.appendChild(textNode);
          }
        }
      }
      if (ignoresCheckedAttribute && isChecked) {
        element.setAttribute('checked', 'checked');
      }
    };

    prototype.cloneNode = function(element, deep){
      var clone = element.cloneNode(!!deep);
      return clone;
    };

    prototype.AttrMorphClass = AttrMorph;

    prototype.createAttrMorph = function(element, attrName, namespace){
      return new this.AttrMorphClass(element, attrName, this, namespace);
    };

    prototype.ElementMorphClass = ElementMorph;

    prototype.createElementMorph = function(element, namespace){
      return new this.ElementMorphClass(element, this, namespace);
    };

    prototype.createUnsafeAttrMorph = function(element, attrName, namespace){
      var morph = this.createAttrMorph(element, attrName, namespace);
      morph.escaped = false;
      return morph;
    };

    prototype.MorphClass = Morph;

    prototype.createMorph = function(parent, start, end, contextualElement){
      if (contextualElement && contextualElement.nodeType === 11) {
        throw new Error("Cannot pass a fragment as the contextual element to createMorph");
      }

      if (!contextualElement && parent && parent.nodeType === 1) {
        contextualElement = parent;
      }
      var morph = new this.MorphClass(this, contextualElement);
      morph.firstNode = start;
      morph.lastNode = end;
      return morph;
    };

    prototype.createFragmentMorph = function(contextualElement) {
      if (contextualElement && contextualElement.nodeType === 11) {
        throw new Error("Cannot pass a fragment as the contextual element to createMorph");
      }

      var fragment = this.createDocumentFragment();
      return Morph.create(this, contextualElement, fragment);
    };

    prototype.replaceContentWithMorph = function(element)  {
      var firstChild = element.firstChild;

      if (!firstChild) {
        var comment = this.createComment('');
        this.appendChild(element, comment);
        return Morph.create(this, element, comment);
      } else {
        var morph = Morph.attach(this, element, firstChild, element.lastChild);
        morph.clear();
        return morph;
      }
    };

    prototype.createUnsafeMorph = function(parent, start, end, contextualElement){
      var morph = this.createMorph(parent, start, end, contextualElement);
      morph.parseTextAsHTML = true;
      return morph;
    };

    // This helper is just to keep the templates good looking,
    // passing integers instead of element references.
    prototype.createMorphAt = function(parent, startIndex, endIndex, contextualElement){
      var single = startIndex === endIndex;
      var start = this.childAtIndex(parent, startIndex);
      var end = single ? start : this.childAtIndex(parent, endIndex);
      return this.createMorph(parent, start, end, contextualElement);
    };

    prototype.createUnsafeMorphAt = function(parent, startIndex, endIndex, contextualElement) {
      var morph = this.createMorphAt(parent, startIndex, endIndex, contextualElement);
      morph.parseTextAsHTML = true;
      return morph;
    };

    prototype.insertMorphBefore = function(element, referenceChild, contextualElement) {
      var insertion = this.document.createComment('');
      element.insertBefore(insertion, referenceChild);
      return this.createMorph(element, insertion, insertion, contextualElement);
    };

    prototype.appendMorph = function(element, contextualElement) {
      var insertion = this.document.createComment('');
      element.appendChild(insertion);
      return this.createMorph(element, insertion, insertion, contextualElement);
    };

    prototype.insertBoundary = function(fragment, index) {
      // this will always be null or firstChild
      var child = index === null ? null : this.childAtIndex(fragment, index);
      this.insertBefore(fragment, this.createTextNode(''), child);
    };

    prototype.parseHTML = function(html, contextualElement) {
      var childNodes;

      if (interiorNamespace(contextualElement) === svgNamespace) {
        childNodes = buildSVGDOM(html, this);
      } else {
        var nodes = buildHTMLDOM(html, contextualElement, this);
        if (detectOmittedStartTag(html, contextualElement)) {
          var node = nodes[0];
          while (node && node.nodeType !== 1) {
            node = node.nextSibling;
          }
          childNodes = node.childNodes;
        } else {
          childNodes = nodes;
        }
      }

      // Copy node list to a fragment.
      var fragment = this.document.createDocumentFragment();

      if (childNodes && childNodes.length > 0) {
        var currentNode = childNodes[0];

        // We prepend an <option> to <select> boxes to absorb any browser bugs
        // related to auto-select behavior. Skip past it.
        if (contextualElement.tagName === 'SELECT') {
          currentNode = currentNode.nextSibling;
        }

        while (currentNode) {
          var tempNode = currentNode;
          currentNode = currentNode.nextSibling;

          fragment.appendChild(tempNode);
        }
      }

      return fragment;
    };

    var parsingNode;

    // Used to determine whether a URL needs to be sanitized.
    prototype.protocolForURL = function(url) {
      if (!parsingNode) {
        parsingNode = this.document.createElement('a');
      }

      parsingNode.href = url;
      return parsingNode.protocol;
    };

    __exports__["default"] = DOMHelper;
  });
define("dom-helper/build-html-dom",
  ["exports"],
  function(__exports__) {
    "use strict";
    /* global XMLSerializer:false */
    var svgHTMLIntegrationPoints = {foreignObject: 1, desc: 1, title: 1};
    __exports__.svgHTMLIntegrationPoints = svgHTMLIntegrationPoints;var svgNamespace = 'http://www.w3.org/2000/svg';
    __exports__.svgNamespace = svgNamespace;
    var doc = typeof document === 'undefined' ? false : document;

    // Safari does not like using innerHTML on SVG HTML integration
    // points (desc/title/foreignObject).
    var needsIntegrationPointFix = doc && (function(document) {
      if (document.createElementNS === undefined) {
        return;
      }
      // In FF title will not accept innerHTML.
      var testEl = document.createElementNS(svgNamespace, 'title');
      testEl.innerHTML = "<div></div>";
      return testEl.childNodes.length === 0 || testEl.childNodes[0].nodeType !== 1;
    })(doc);

    // Internet Explorer prior to 9 does not allow setting innerHTML if the first element
    // is a "zero-scope" element. This problem can be worked around by making
    // the first node an invisible text node. We, like Modernizr, use &shy;
    var needsShy = doc && (function(document) {
      var testEl = document.createElement('div');
      testEl.innerHTML = "<div></div>";
      testEl.firstChild.innerHTML = "<script><\/script>";
      return testEl.firstChild.innerHTML === '';
    })(doc);

    // IE 8 (and likely earlier) likes to move whitespace preceeding
    // a script tag to appear after it. This means that we can
    // accidentally remove whitespace when updating a morph.
    var movesWhitespace = doc && (function(document) {
      var testEl = document.createElement('div');
      testEl.innerHTML = "Test: <script type='text/x-placeholder'><\/script>Value";
      return testEl.childNodes[0].nodeValue === 'Test:' &&
              testEl.childNodes[2].nodeValue === ' Value';
    })(doc);

    var tagNamesRequiringInnerHTMLFix = doc && (function(document) {
      var tagNamesRequiringInnerHTMLFix;
      // IE 9 and earlier don't allow us to set innerHTML on col, colgroup, frameset,
      // html, style, table, tbody, tfoot, thead, title, tr. Detect this and add
      // them to an initial list of corrected tags.
      //
      // Here we are only dealing with the ones which can have child nodes.
      //
      var tableNeedsInnerHTMLFix;
      var tableInnerHTMLTestElement = document.createElement('table');
      try {
        tableInnerHTMLTestElement.innerHTML = '<tbody></tbody>';
      } catch (e) {
      } finally {
        tableNeedsInnerHTMLFix = (tableInnerHTMLTestElement.childNodes.length === 0);
      }
      if (tableNeedsInnerHTMLFix) {
        tagNamesRequiringInnerHTMLFix = {
          colgroup: ['table'],
          table: [],
          tbody: ['table'],
          tfoot: ['table'],
          thead: ['table'],
          tr: ['table', 'tbody']
        };
      }

      // IE 8 doesn't allow setting innerHTML on a select tag. Detect this and
      // add it to the list of corrected tags.
      //
      var selectInnerHTMLTestElement = document.createElement('select');
      selectInnerHTMLTestElement.innerHTML = '<option></option>';
      if (!selectInnerHTMLTestElement.childNodes[0]) {
        tagNamesRequiringInnerHTMLFix = tagNamesRequiringInnerHTMLFix || {};
        tagNamesRequiringInnerHTMLFix.select = [];
      }
      return tagNamesRequiringInnerHTMLFix;
    })(doc);

    function scriptSafeInnerHTML(element, html) {
      // without a leading text node, IE will drop a leading script tag.
      html = '&shy;'+html;

      element.innerHTML = html;

      var nodes = element.childNodes;

      // Look for &shy; to remove it.
      var shyElement = nodes[0];
      while (shyElement.nodeType === 1 && !shyElement.nodeName) {
        shyElement = shyElement.firstChild;
      }
      // At this point it's the actual unicode character.
      if (shyElement.nodeType === 3 && shyElement.nodeValue.charAt(0) === "\u00AD") {
        var newValue = shyElement.nodeValue.slice(1);
        if (newValue.length) {
          shyElement.nodeValue = shyElement.nodeValue.slice(1);
        } else {
          shyElement.parentNode.removeChild(shyElement);
        }
      }

      return nodes;
    }

    function buildDOMWithFix(html, contextualElement){
      var tagName = contextualElement.tagName;

      // Firefox versions < 11 do not have support for element.outerHTML.
      var outerHTML = contextualElement.outerHTML || new XMLSerializer().serializeToString(contextualElement);
      if (!outerHTML) {
        throw "Can't set innerHTML on "+tagName+" in this browser";
      }

      html = fixSelect(html, contextualElement);

      var wrappingTags = tagNamesRequiringInnerHTMLFix[tagName.toLowerCase()];

      var startTag = outerHTML.match(new RegExp("<"+tagName+"([^>]*)>", 'i'))[0];
      var endTag = '</'+tagName+'>';

      var wrappedHTML = [startTag, html, endTag];

      var i = wrappingTags.length;
      var wrappedDepth = 1 + i;
      while(i--) {
        wrappedHTML.unshift('<'+wrappingTags[i]+'>');
        wrappedHTML.push('</'+wrappingTags[i]+'>');
      }

      var wrapper = document.createElement('div');
      scriptSafeInnerHTML(wrapper, wrappedHTML.join(''));
      var element = wrapper;
      while (wrappedDepth--) {
        element = element.firstChild;
        while (element && element.nodeType !== 1) {
          element = element.nextSibling;
        }
      }
      while (element && element.tagName !== tagName) {
        element = element.nextSibling;
      }
      return element ? element.childNodes : [];
    }

    var buildDOM;
    if (needsShy) {
      buildDOM = function buildDOM(html, contextualElement, dom){
        html = fixSelect(html, contextualElement);

        contextualElement = dom.cloneNode(contextualElement, false);
        scriptSafeInnerHTML(contextualElement, html);
        return contextualElement.childNodes;
      };
    } else {
      buildDOM = function buildDOM(html, contextualElement, dom){
        html = fixSelect(html, contextualElement);

        contextualElement = dom.cloneNode(contextualElement, false);
        contextualElement.innerHTML = html;
        return contextualElement.childNodes;
      };
    }

    function fixSelect(html, contextualElement) {
      if (contextualElement.tagName === 'SELECT') {
        html = "<option></option>" + html;
      }

      return html;
    }

    var buildIESafeDOM;
    if (tagNamesRequiringInnerHTMLFix || movesWhitespace) {
      buildIESafeDOM = function buildIESafeDOM(html, contextualElement, dom) {
        // Make a list of the leading text on script nodes. Include
        // script tags without any whitespace for easier processing later.
        var spacesBefore = [];
        var spacesAfter = [];
        if (typeof html === 'string') {
          html = html.replace(/(\s*)(<script)/g, function(match, spaces, tag) {
            spacesBefore.push(spaces);
            return tag;
          });

          html = html.replace(/(<\/script>)(\s*)/g, function(match, tag, spaces) {
            spacesAfter.push(spaces);
            return tag;
          });
        }

        // Fetch nodes
        var nodes;
        if (tagNamesRequiringInnerHTMLFix[contextualElement.tagName.toLowerCase()]) {
          // buildDOMWithFix uses string wrappers for problematic innerHTML.
          nodes = buildDOMWithFix(html, contextualElement);
        } else {
          nodes = buildDOM(html, contextualElement, dom);
        }

        // Build a list of script tags, the nodes themselves will be
        // mutated as we add test nodes.
        var i, j, node, nodeScriptNodes;
        var scriptNodes = [];
        for (i=0;i<nodes.length;i++) {
          node=nodes[i];
          if (node.nodeType !== 1) {
            continue;
          }
          if (node.tagName === 'SCRIPT') {
            scriptNodes.push(node);
          } else {
            nodeScriptNodes = node.getElementsByTagName('script');
            for (j=0;j<nodeScriptNodes.length;j++) {
              scriptNodes.push(nodeScriptNodes[j]);
            }
          }
        }

        // Walk the script tags and put back their leading text nodes.
        var scriptNode, textNode, spaceBefore, spaceAfter;
        for (i=0;i<scriptNodes.length;i++) {
          scriptNode = scriptNodes[i];
          spaceBefore = spacesBefore[i];
          if (spaceBefore && spaceBefore.length > 0) {
            textNode = dom.document.createTextNode(spaceBefore);
            scriptNode.parentNode.insertBefore(textNode, scriptNode);
          }

          spaceAfter = spacesAfter[i];
          if (spaceAfter && spaceAfter.length > 0) {
            textNode = dom.document.createTextNode(spaceAfter);
            scriptNode.parentNode.insertBefore(textNode, scriptNode.nextSibling);
          }
        }

        return nodes;
      };
    } else {
      buildIESafeDOM = buildDOM;
    }

    var buildHTMLDOM;
    if (needsIntegrationPointFix) {
      buildHTMLDOM = function buildHTMLDOM(html, contextualElement, dom){
        if (svgHTMLIntegrationPoints[contextualElement.tagName]) {
          return buildIESafeDOM(html, document.createElement('div'), dom);
        } else {
          return buildIESafeDOM(html, contextualElement, dom);
        }
      };
    } else {
      buildHTMLDOM = buildIESafeDOM;
    }

    __exports__.buildHTMLDOM = buildHTMLDOM;
  });
define("dom-helper/classes",
  ["exports"],
  function(__exports__) {
    "use strict";
    var doc = typeof document === 'undefined' ? false : document;

    // PhantomJS has a broken classList. See https://github.com/ariya/phantomjs/issues/12782
    var canClassList = doc && (function(){
      var d = document.createElement('div');
      if (!d.classList) {
        return false;
      }
      d.classList.add('boo');
      d.classList.add('boo', 'baz');
      return (d.className === 'boo baz');
    })();

    function buildClassList(element) {
      var classString = (element.getAttribute('class') || '');
      return classString !== '' && classString !== ' ' ? classString.split(' ') : [];
    }

    function intersect(containingArray, valuesArray) {
      var containingIndex = 0;
      var containingLength = containingArray.length;
      var valuesIndex = 0;
      var valuesLength = valuesArray.length;

      var intersection = new Array(valuesLength);

      // TODO: rewrite this loop in an optimal manner
      for (;containingIndex<containingLength;containingIndex++) {
        valuesIndex = 0;
        for (;valuesIndex<valuesLength;valuesIndex++) {
          if (valuesArray[valuesIndex] === containingArray[containingIndex]) {
            intersection[valuesIndex] = containingIndex;
            break;
          }
        }
      }

      return intersection;
    }

    function addClassesViaAttribute(element, classNames) {
      var existingClasses = buildClassList(element);

      var indexes = intersect(existingClasses, classNames);
      var didChange = false;

      for (var i=0, l=classNames.length; i<l; i++) {
        if (indexes[i] === undefined) {
          didChange = true;
          existingClasses.push(classNames[i]);
        }
      }

      if (didChange) {
        element.setAttribute('class', existingClasses.length > 0 ? existingClasses.join(' ') : '');
      }
    }

    function removeClassesViaAttribute(element, classNames) {
      var existingClasses = buildClassList(element);

      var indexes = intersect(classNames, existingClasses);
      var didChange = false;
      var newClasses = [];

      for (var i=0, l=existingClasses.length; i<l; i++) {
        if (indexes[i] === undefined) {
          newClasses.push(existingClasses[i]);
        } else {
          didChange = true;
        }
      }

      if (didChange) {
        element.setAttribute('class', newClasses.length > 0 ? newClasses.join(' ') : '');
      }
    }

    var addClasses, removeClasses;
    if (canClassList) {
      addClasses = function addClasses(element, classNames) {
        if (element.classList) {
          if (classNames.length === 1) {
            element.classList.add(classNames[0]);
          } else if (classNames.length === 2) {
            element.classList.add(classNames[0], classNames[1]);
          } else {
            element.classList.add.apply(element.classList, classNames);
          }
        } else {
          addClassesViaAttribute(element, classNames);
        }
      };
      removeClasses = function removeClasses(element, classNames) {
        if (element.classList) {
          if (classNames.length === 1) {
            element.classList.remove(classNames[0]);
          } else if (classNames.length === 2) {
            element.classList.remove(classNames[0], classNames[1]);
          } else {
            element.classList.remove.apply(element.classList, classNames);
          }
        } else {
          removeClassesViaAttribute(element, classNames);
        }
      };
    } else {
      addClasses = addClassesViaAttribute;
      removeClasses = removeClassesViaAttribute;
    }

    __exports__.addClasses = addClasses;
    __exports__.removeClasses = removeClasses;
  });
define("dom-helper/prop",
  ["exports"],
  function(__exports__) {
    "use strict";
    function isAttrRemovalValue(value) {
      return value === null || value === undefined;
    }

    __exports__.isAttrRemovalValue = isAttrRemovalValue;// TODO should this be an o_create kind of thing?
    var propertyCaches = {};
    __exports__.propertyCaches = propertyCaches;
    function normalizeProperty(element, attrName) {
      var tagName = element.tagName;
      var key;
      var cache = propertyCaches[tagName];
      if (!cache) {
        // TODO should this be an o_create kind of thing?
        cache = {};
        for (key in element) {
          cache[key.toLowerCase()] = key;
        }
        propertyCaches[tagName] = cache;
      }

      // presumes that the attrName has been lowercased.
      return cache[attrName];
    }

    __exports__.normalizeProperty = normalizeProperty;
  });
define("htmlbars-runtime",
  ["htmlbars-runtime/hooks","htmlbars-runtime/render","../htmlbars-util/morph-utils","../htmlbars-util/template-utils","htmlbars-runtime/expression-visitor","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __dependency5__, __exports__) {
    "use strict";
    var hooks = __dependency1__["default"];
    var render = __dependency2__["default"];
    var manualElement = __dependency2__.manualElement;
    var visitChildren = __dependency3__.visitChildren;
    var blockFor = __dependency4__.blockFor;
    var clearMorph = __dependency4__.clearMorph;
    var validateChildMorphs = __dependency5__.validateChildMorphs;
    var hostBlock = __dependency1__.hostBlock;
    var continueBlock = __dependency1__.continueBlock;
    var hostYieldWithShadowTemplate = __dependency1__.hostYieldWithShadowTemplate;


    var internal = {
      blockFor: blockFor,
      manualElement: manualElement,
      hostBlock: hostBlock,
      continueBlock: continueBlock,
      hostYieldWithShadowTemplate: hostYieldWithShadowTemplate,
      visitChildren: visitChildren,
      validateChildMorphs: validateChildMorphs,
      clearMorph: clearMorph
    };

    __exports__.hooks = hooks;
    __exports__.render = render;
    __exports__.internal = internal;
  });
define("htmlbars-runtime/expression-visitor",
  ["../htmlbars-util/object-utils","../htmlbars-util/morph-utils","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var merge = __dependency1__.merge;
    var createObject = __dependency1__.createObject;
    var validateChildMorphs = __dependency2__.validateChildMorphs;
    var linkParams = __dependency2__.linkParams;

    /**
      Node classification:

      # Primary Statement Nodes:

      These nodes are responsible for a render node that represents a morph-range.

      * block
      * inline
      * content
      * element
      * component

      # Leaf Statement Nodes:

      This node is responsible for a render node that represents a morph-attr.

      * attribute

      # Expression Nodes:

      These nodes are not directly responsible for any part of the DOM, but are
      eventually passed to a Statement Node.

      * get
      * subexpr
      * concat
    */

    var base = {
      acceptExpression: function(node, morph, env, scope) {
        var ret = { value: null };

        // Primitive literals are unambiguously non-array representations of
        // themselves.
        if (typeof node !== 'object') {
          ret.value = node;
          return ret;
        }

        switch(node[0]) {
          // can be used by manualElement
          case 'value': ret.value = node[1]; break;
          case 'get': ret.value = this.get(node, morph, env, scope); break;
          case 'subexpr': ret.value = this.subexpr(node, morph, env, scope); break;
          case 'concat': ret.value = this.concat(node, morph, env, scope); break;
        }

        return ret;
      },

      acceptParamsAndHash: function(env, scope, morph, path, params, hash) {
        params = params && this.acceptParams(params, morph, env, scope);
        hash = hash && this.acceptHash(hash, morph, env, scope);

        linkParams(env, scope, morph, path, params, hash);
        return [params, hash];
      },

      acceptParams: function(nodes, morph, env, scope) {
        if (morph.linkedParams) {
          return morph.linkedParams.params;
        }

        var arr = new Array(nodes.length);

        for (var i=0, l=nodes.length; i<l; i++) {
          arr[i] =  this.acceptExpression(nodes[i], morph, env, scope, null, null).value;
        }

        return arr;
      },

      acceptHash: function(pairs, morph, env, scope) {
        if (morph.linkedParams) {
          return morph.linkedParams.hash;
        }

        var object = {};

        for (var i=0, l=pairs.length; i<l; i += 2) {
          object[pairs[i]] = this.acceptExpression(pairs[i+1], morph, env, scope, null, null).value;
        }

        return object;
      },

      // [ 'get', path ]
      get: function(node, morph, env, scope) {
        return env.hooks.get(env, scope, node[1]);
      },

      // [ 'subexpr', path, params, hash ]
      subexpr: function(node, morph, env, scope) {
        var path = node[1], params = node[2], hash = node[3];
        return env.hooks.subexpr(env, scope, path,
                                 this.acceptParams(params, morph, env, scope),
                                 this.acceptHash(hash, morph, env, scope));
      },

      // [ 'concat', parts ]
      concat: function(node, morph, env, scope) {
        return env.hooks.concat(env, this.acceptParams(node[1], morph, env, scope));
      }
    };

    var AlwaysDirtyVisitor = merge(createObject(base), {
      // [ 'block', path, params, hash, templateId, inverseId ]
      block: function(node, morph, env, scope, template, visitor) {
        var path = node[1], params = node[2], hash = node[3], templateId = node[4], inverseId = node[5];
        var paramsAndHash = this.acceptParamsAndHash(env, scope, morph, path, params, hash);

        morph.isDirty = morph.isSubtreeDirty = false;
        env.hooks.block(morph, env, scope, path, paramsAndHash[0], paramsAndHash[1],
                               templateId === null ? null : template.templates[templateId],
                               inverseId === null ? null : template.templates[inverseId],
                               visitor);
      },

      // [ 'inline', path, params, hash ]
      inline: function(node, morph, env, scope, visitor) {
        var path = node[1], params = node[2], hash = node[3];
        var paramsAndHash = this.acceptParamsAndHash(env, scope, morph, path, params, hash);

        morph.isDirty = morph.isSubtreeDirty = false;
        env.hooks.inline(morph, env, scope, path, paramsAndHash[0], paramsAndHash[1], visitor);
      },

      // [ 'content', path ]
      content: function(node, morph, env, scope, visitor) {
        var path = node[1];

        morph.isDirty = morph.isSubtreeDirty = false;

        if (isHelper(env, scope, path)) {
          env.hooks.inline(morph, env, scope, path, [], {}, visitor);
          return;
        }

        var params;
        if (morph.linkedParams) {
          params = morph.linkedParams.params;
        } else {
          params = [env.hooks.get(env, scope, path)];
        }

        linkParams(env, scope, morph, '@range', params, null);
        env.hooks.range(morph, env, scope, path, params[0], visitor);
      },

      // [ 'element', path, params, hash ]
      element: function(node, morph, env, scope, visitor) {
        var path = node[1], params = node[2], hash = node[3];
        var paramsAndHash = this.acceptParamsAndHash(env, scope, morph, path, params, hash);

        morph.isDirty = morph.isSubtreeDirty = false;
        env.hooks.element(morph, env, scope, path, paramsAndHash[0], paramsAndHash[1], visitor);
      },

      // [ 'attribute', name, value ]
      attribute: function(node, morph, env, scope) {
        var name = node[1], value = node[2];
        var paramsAndHash = this.acceptParamsAndHash(env, scope, morph, '@attribute', [value], null);

        morph.isDirty = morph.isSubtreeDirty = false;
        env.hooks.attribute(morph, env, scope, name, paramsAndHash[0][0]);
      },

      // [ 'component', path, attrs, templateId ]
      component: function(node, morph, env, scope, template, visitor) {
        var path = node[1], attrs = node[2], templateId = node[3];
        var paramsAndHash = this.acceptParamsAndHash(env, scope, morph, path, null, attrs);

        morph.isDirty = morph.isSubtreeDirty = false;
        env.hooks.component(morph, env, scope, path, paramsAndHash[1],
                            template.templates[templateId], visitor);
      }
    });
    __exports__.AlwaysDirtyVisitor = AlwaysDirtyVisitor;
    __exports__["default"] = merge(createObject(base), {
      // [ 'block', path, params, hash, templateId, inverseId ]
      block: function(node, morph, env, scope, template, visitor) {
        dirtyCheck(env, morph, visitor, function(visitor) {
          AlwaysDirtyVisitor.block(node, morph, env, scope, template, visitor);
        });
      },

      // [ 'inline', path, params, hash ]
      inline: function(node, morph, env, scope, visitor) {
        dirtyCheck(env, morph, visitor, function(visitor) {
          AlwaysDirtyVisitor.inline(node, morph, env, scope, visitor);
        });
      },

      // [ 'content', path ]
      content: function(node, morph, env, scope, visitor) {
        dirtyCheck(env, morph, visitor, function(visitor) {
          AlwaysDirtyVisitor.content(node, morph, env, scope, visitor);
        });
      },

      // [ 'element', path, params, hash ]
      element: function(node, morph, env, scope, template, visitor) {
        dirtyCheck(env, morph, visitor, function(visitor) {
          AlwaysDirtyVisitor.element(node, morph, env, scope, template, visitor);
        });
      },

      // [ 'attribute', name, value ]
      attribute: function(node, morph, env, scope, template) {
        dirtyCheck(env, morph, null, function() {
          AlwaysDirtyVisitor.attribute(node, morph, env, scope, template);
        });
      },

      // [ 'component', path, attrs, templateId ]
      component: function(node, morph, env, scope, template, visitor) {
        dirtyCheck(env, morph, visitor, function(visitor) {
          AlwaysDirtyVisitor.component(node, morph, env, scope, template, visitor);
        });
      },
    });

    function dirtyCheck(env, morph, visitor, callback) {
      var isDirty = morph.isDirty;
      var isSubtreeDirty = morph.isSubtreeDirty;

      if (isSubtreeDirty) {
        visitor = AlwaysDirtyVisitor;
      }

      if (isDirty || isSubtreeDirty) {
        callback(visitor);
      } else {
        validateChildMorphs(env, morph, visitor);
      }
    }

    function isHelper(env, scope, path) {
      return (env.hooks.keywords[path] !== undefined) || env.hooks.hasHelper(env, scope, path);
    }
  });
define("htmlbars-runtime/hooks",
  ["./render","../morph-range/morph-list","../htmlbars-util/object-utils","../htmlbars-util/morph-utils","../htmlbars-util/template-utils","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __dependency5__, __exports__) {
    "use strict";
    var render = __dependency1__["default"];
    var MorphList = __dependency2__["default"];
    var createChildMorph = __dependency1__.createChildMorph;
    var createObject = __dependency3__.createObject;
    var keyLength = __dependency3__.keyLength;
    var shallowCopy = __dependency3__.shallowCopy;
    var merge = __dependency3__.merge;
    var validateChildMorphs = __dependency4__.validateChildMorphs;
    var clearMorph = __dependency5__.clearMorph;
    var renderAndCleanup = __dependency5__.renderAndCleanup;

    /**
      HTMLBars delegates the runtime behavior of a template to
      hooks provided by the host environment. These hooks explain
      the lexical environment of a Handlebars template, the internal
      representation of references, and the interaction between an
      HTMLBars template and the DOM it is managing.

      While HTMLBars host hooks have access to all of this internal
      machinery, templates and helpers have access to the abstraction
      provided by the host hooks.

      ## The Lexical Environment

      The default lexical environment of an HTMLBars template includes:

      * Any local variables, provided by *block arguments*
      * The current value of `self`

      ## Simple Nesting

      Let's look at a simple template with a nested block:

      ```hbs
      <h1>{{title}}</h1>

      {{#if author}}
        <p class="byline">{{author}}</p>
      {{/if}}
      ```

      In this case, the lexical environment at the top-level of the
      template does not change inside of the `if` block. This is
      achieved via an implementation of `if` that looks like this:

      ```js
      registerHelper('if', function(params) {
        if (!!params[0]) {
          return this.yield();
        }
      });
      ```

      A call to `this.yield` invokes the child template using the
      current lexical environment.

      ## Block Arguments

      It is possible for nested blocks to introduce new local
      variables:

      ```hbs
      {{#count-calls as |i|}}
      <h1>{{title}}</h1>
      <p>Called {{i}} times</p>
      {{/count}}
      ```

      In this example, the child block inherits its surrounding
      lexical environment, but augments it with a single new
      variable binding.

      The implementation of `count-calls` supplies the value of
      `i`, but does not otherwise alter the environment:

      ```js
      var count = 0;
      registerHelper('count-calls', function() {
        return this.yield([ ++count ]);
      });
      ```
    */

    function wrap(template) {
      if (template === null) { return null;  }

      return {
        isHTMLBars: true,
        arity: template.arity,
        revision: template.revision,
        raw: template,
        render: function(self, env, options, blockArguments) {
          var scope = env.hooks.createFreshScope();

          options = options || {};
          options.self = self;
          options.blockArguments = blockArguments;

          return render(template, env, scope, options);
        }
      };
    }

    __exports__.wrap = wrap;function wrapForHelper(template, env, scope, morph, renderState, visitor) {
      if (template === null) {
        return {
          yieldIn: yieldInShadowTemplate(null, env, scope, morph, renderState, visitor)
        };
      }

      var yieldArgs = yieldTemplate(template, env, scope, morph, renderState, visitor);

      return {
        arity: template.arity,
        revision: template.revision,
        yield: yieldArgs,
        yieldItem: yieldItem(template, env, scope, morph, renderState, visitor),
        yieldIn: yieldInShadowTemplate(template, env, scope, morph, renderState, visitor),

        render: function(self, blockArguments) {
          yieldArgs(blockArguments, self);
        }
      };
    }

    __exports__.wrapForHelper = wrapForHelper;function yieldTemplate(template, env, parentScope, morph, renderState, visitor) {
      return function(blockArguments, self) {
        renderState.clearMorph = null;

        if (morph.morphList) {
          renderState.morphList = morph.morphList.firstChildMorph;
          renderState.morphList = null;
        }

        var scope = parentScope;

        if (morph.lastYielded && isStableTemplate(template, morph.lastYielded)) {
          return morph.lastResult.revalidateWith(env, undefined, self, blockArguments, visitor);
        }

        // Check to make sure that we actually **need** a new scope, and can't
        // share the parent scope. Note that we need to move this check into
        // a host hook, because the host's notion of scope may require a new
        // scope in more cases than the ones we can determine statically.
        if (self !== undefined || parentScope === null || template.arity) {
          scope = env.hooks.createChildScope(parentScope);
        }

        morph.lastYielded = { self: self, template: template, shadowTemplate: null };

        // Render the template that was selected by the helper
        render(template, env, scope, { renderNode: morph, self: self, blockArguments: blockArguments });
      };
    }

    function yieldItem(template, env, parentScope, morph, renderState, visitor) {
      var currentMorph = null;
      var morphList = morph.morphList;
      if (morphList) {
        currentMorph = morphList.firstChildMorph;
        renderState.morphListStart = currentMorph;
      }

      return function(key, blockArguments, self) {
        if (typeof key !== 'string') {
          throw new Error("You must provide a string key when calling `yieldItem`; you provided " + key);
        }

        var morphList, morphMap;

        if (!morph.morphList) {
          morph.morphList = new MorphList();
          morph.morphMap = {};
          morph.setMorphList(morph.morphList);
        }

        morphList = morph.morphList;
        morphMap = morph.morphMap;

        if (currentMorph && currentMorph.key === key) {
          yieldTemplate(template, env, parentScope, currentMorph, renderState, visitor)(blockArguments, self);
          currentMorph = currentMorph.nextMorph;
        } else if (currentMorph && morphMap[key] !== undefined) {
          var foundMorph = morphMap[key];
          yieldTemplate(template, env, parentScope, foundMorph, renderState, visitor)(blockArguments, self);
          morphList.insertBeforeMorph(foundMorph, currentMorph);
        } else {
          var childMorph = createChildMorph(env.dom, morph);
          childMorph.key = key;
          morphMap[key] = childMorph;
          morphList.insertBeforeMorph(childMorph, currentMorph);
          yieldTemplate(template, env, parentScope, childMorph, renderState, visitor)(blockArguments, self);
        }

        renderState.morphListStart = currentMorph;
        renderState.clearMorph = morph.childNodes;
        morph.childNodes = null;
      };
    }

    function isStableTemplate(template, lastYielded) {
      return !lastYielded.shadowTemplate && template === lastYielded.template;
    }

    function yieldInShadowTemplate(template, env, parentScope, morph, renderState, visitor) {
      var hostYield = hostYieldWithShadowTemplate(template, env, parentScope, morph, renderState, visitor);

      return function(shadowTemplate, self) {
        hostYield(shadowTemplate, env, self, []);
      };
    }

    function hostYieldWithShadowTemplate(template, env, parentScope, morph, renderState, visitor) {
      return function(shadowTemplate, env, self, blockArguments) {
        renderState.clearMorph = null;

        if (morph.lastYielded && isStableShadowRoot(template, shadowTemplate, morph.lastYielded)) {
          return morph.lastResult.revalidateWith(env, undefined, self, blockArguments, visitor);
        }

        var shadowScope = env.hooks.createFreshScope();
        env.hooks.bindShadowScope(env, parentScope, shadowScope, renderState.shadowOptions);
        env.hooks.bindBlock(env, shadowScope, blockToYield);

        morph.lastYielded = { self: self, template: template, shadowTemplate: shadowTemplate };

        // Render the shadow template with the block available
        render(shadowTemplate.raw, env, shadowScope, { renderNode: morph, self: self, blockArguments: blockArguments });
      };

      function blockToYield(env, blockArguments, renderNode, shadowParent, visitor) {
        if (renderNode.lastResult) {
          renderNode.lastResult.revalidateWith(env, undefined, undefined, blockArguments, visitor);
        } else {
          var scope = parentScope;

          // Since a yielded template shares a `self` with its original context,
          // we only need to create a new scope if the template has block parameters
          if (template.arity) {
            scope = env.hooks.createChildScope(parentScope);
          }

          render(template, env, scope, { renderNode: renderNode, blockArguments: blockArguments });
        }
      }
    }

    __exports__.hostYieldWithShadowTemplate = hostYieldWithShadowTemplate;function isStableShadowRoot(template, shadowTemplate, lastYielded) {
      return template === lastYielded.template && shadowTemplate === lastYielded.shadowTemplate;
    }

    function optionsFor(template, inverse, env, scope, morph, visitor) {
      var renderState = { morphListStart: null, clearMorph: morph, shadowOptions: null };

      return {
        templates: {
          template: wrapForHelper(template, env, scope, morph, renderState, visitor),
          inverse: wrapForHelper(inverse, env, scope, morph, renderState, visitor)
        },
        renderState: renderState
      };
    }

    function thisFor(options) {
      return {
        arity: options.template.arity,
        yield: options.template.yield,
        yieldItem: options.template.yieldItem,
        yieldIn: options.template.yieldIn
      };
    }

    /**
      Host Hook: createScope

      @param {Scope?} parentScope
      @return Scope

      Corresponds to entering a new HTMLBars block.

      This hook is invoked when a block is entered with
      a new `self` or additional local variables.

      When invoked for a top-level template, the
      `parentScope` is `null`, and this hook should return
      a fresh Scope.

      When invoked for a child template, the `parentScope`
      is the scope for the parent environment.

      Note that the `Scope` is an opaque value that is
      passed to other host hooks. For example, the `get`
      hook uses the scope to retrieve a value for a given
      scope and variable name.
    */
    function createScope(env, parentScope) {
      if (parentScope) {
        return env.hooks.createChildScope(parentScope);
      } else {
        return env.hooks.createFreshScope();
      }
    }

    __exports__.createScope = createScope;function createFreshScope() {
      // because `in` checks have unpredictable performance, keep a
      // separate dictionary to track whether a local was bound.
      // See `bindLocal` for more information.
      return { self: null, block: null, locals: {}, localPresent: {} };
    }

    __exports__.createFreshScope = createFreshScope;/**
      Host Hook: createShadowScope

      @param {Scope?} parentScope
      @return Scope

      Corresponds to rendering a new template into an existing
      render tree, but with a new top-level lexical scope. This
      template is called the "shadow root".

      If a shadow template invokes `{{yield}}`, it will render
      the block provided to the shadow root in the original
      lexical scope.

      ```hbs
      {{!-- post template --}}
      <p>{{props.title}}</p>
      {{yield}}

      {{!-- blog template --}}
      {{#post title="Hello world"}}
        <p>by {{byline}}</p>
        <article>This is my first post</article>
      {{/post}}

      {{#post title="Goodbye world"}}
        <p>by {{byline}}</p>
        <article>This is my last post</article>
      {{/post}}
      ```

      ```js
      helpers.post = function(params, hash, options) {
        options.template.yieldIn(postTemplate, { props: hash });
      };

      blog.render({ byline: "Yehuda Katz" });
      ```

      Produces:

      ```html
      <p>Hello world</p>
      <p>by Yehuda Katz</p>
      <article>This is my first post</article>

      <p>Goodbye world</p>
      <p>by Yehuda Katz</p>
      <article>This is my last post</article>
      ```

      In short, `yieldIn` creates a new top-level scope for the
      provided template and renders it, making the original block
      available to `{{yield}}` in that template.
    */
    function bindShadowScope(env /*, parentScope, shadowScope */) {
      return env.hooks.createFreshScope();
    }

    __exports__.bindShadowScope = bindShadowScope;function createChildScope(parent) {
      var scope = createObject(parent);
      scope.locals = createObject(parent.locals);
      return scope;
    }

    __exports__.createChildScope = createChildScope;/**
      Host Hook: bindSelf

      @param {Scope} scope
      @param {any} self

      Corresponds to entering a template.

      This hook is invoked when the `self` value for a scope is ready to be bound.

      The host must ensure that child scopes reflect the change to the `self` in
      future calls to the `get` hook.
    */
    function bindSelf(env, scope, self) {
      scope.self = self;
    }

    __exports__.bindSelf = bindSelf;function updateSelf(env, scope, self) {
      env.hooks.bindSelf(env, scope, self);
    }

    __exports__.updateSelf = updateSelf;/**
      Host Hook: bindLocal

      @param {Environment} env
      @param {Scope} scope
      @param {String} name
      @param {any} value

      Corresponds to entering a template with block arguments.

      This hook is invoked when a local variable for a scope has been provided.

      The host must ensure that child scopes reflect the change in future calls
      to the `get` hook.
    */
    function bindLocal(env, scope, name, value) {
      scope.localPresent[name] = true;
      scope.locals[name] = value;
    }

    __exports__.bindLocal = bindLocal;function updateLocal(env, scope, name, value) {
      env.hooks.bindLocal(env, scope, name, value);
    }

    __exports__.updateLocal = updateLocal;/**
      Host Hook: bindBlock

      @param {Environment} env
      @param {Scope} scope
      @param {Function} block

      Corresponds to entering a shadow template that was invoked by a block helper with
      `yieldIn`.

      This hook is invoked with an opaque block that will be passed along to the
      shadow template, and inserted into the shadow template when `{{yield}}` is used.
    */
    function bindBlock(env, scope, block) {
      scope.block = block;
    }

    __exports__.bindBlock = bindBlock;/**
      Host Hook: block

      @param {RenderNode} renderNode
      @param {Environment} env
      @param {Scope} scope
      @param {String} path
      @param {Array} params
      @param {Object} hash
      @param {Block} block
      @param {Block} elseBlock

      Corresponds to:

      ```hbs
      {{#helper param1 param2 key1=val1 key2=val2}}
        {{!-- child template --}}
      {{/helper}}
      ```

      This host hook is a workhorse of the system. It is invoked
      whenever a block is encountered, and is responsible for
      resolving the helper to call, and then invoke it.

      The helper should be invoked with:

      - `{Array} params`: the parameters passed to the helper
        in the template.
      - `{Object} hash`: an object containing the keys and values passed
        in the hash position in the template.

      The values in `params` and `hash` will already be resolved
      through a previous call to the `get` host hook.

      The helper should be invoked with a `this` value that is
      an object with one field:

      `{Function} yield`: when invoked, this function executes the
      block with the current scope. It takes an optional array of
      block parameters. If block parameters are supplied, HTMLBars
      will invoke the `bindLocal` host hook to bind the supplied
      values to the block arguments provided by the template.

      In general, the default implementation of `block` should work
      for most host environments. It delegates to other host hooks
      where appropriate, and properly invokes the helper with the
      appropriate arguments.
    */
    function block(morph, env, scope, path, params, hash, template, inverse, visitor) {
      if (handleRedirect(morph, env, scope, path, params, hash, template, inverse, visitor)) {
        return;
      }

      continueBlock(morph, env, scope, path, params, hash, template, inverse, visitor);
    }

    __exports__.block = block;function continueBlock(morph, env, scope, path, params, hash, template, inverse, visitor) {
      hostBlock(morph, env, scope, template, inverse, null, visitor, function(options) {
        var helper = env.hooks.lookupHelper(env, scope, path);
        env.hooks.invokeHelper(morph, env, scope, visitor, params, hash, helper, options.templates, thisFor(options.templates));
      });
    }

    __exports__.continueBlock = continueBlock;function hostBlock(morph, env, scope, template, inverse, shadowOptions, visitor, callback) {
      var options = optionsFor(template, inverse, env, scope, morph, visitor);
      renderAndCleanup(morph, env, options, shadowOptions, callback);
    }

    __exports__.hostBlock = hostBlock;function handleRedirect(morph, env, scope, path, params, hash, template, inverse, visitor) {
      var redirect = env.hooks.classify(env, scope, path);
      if (redirect) {
        switch(redirect) {
          case 'component': env.hooks.component(morph, env, scope, path, hash, template, visitor); break;
          case 'inline': env.hooks.inline(morph, env, scope, path, params, hash, visitor); break;
          case 'block': env.hooks.block(morph, env, scope, path, params, hash, template, inverse, visitor); break;
          default: throw new Error("Internal HTMLBars redirection to " + redirect + " not supported");
        }
        return true;
      }

      if (handleKeyword(path, morph, env, scope, params, hash, template, inverse, visitor)) {
        return true;
      }

      return false;
    }

    function handleKeyword(path, morph, env, scope, params, hash, template, inverse, visitor) {
      var keyword = env.hooks.keywords[path];
      if (!keyword) { return false; }

      if (typeof keyword === 'function') {
        return keyword(morph, env, scope, params, hash, template, inverse, visitor);
      }

      if (keyword.willRender) {
        keyword.willRender(morph, env);
      }

      var lastState, newState;
      if (keyword.setupState) {
        lastState = shallowCopy(morph.state);
        newState = morph.state = keyword.setupState(lastState, env, scope, params, hash);
      }

      if (keyword.childEnv) {
        env = merge(keyword.childEnv(morph.state), env);
      }

      var firstTime = !morph.rendered;

      if (keyword.isEmpty) {
        var isEmpty = keyword.isEmpty(morph.state, env, scope, params, hash);

        if (isEmpty) {
          if (!firstTime) { clearMorph(morph, env, false); }
          return true;
        }
      }

      if (firstTime) {
        if (keyword.render) {
          keyword.render(morph, env, scope, params, hash, template, inverse, visitor);
        }
        morph.rendered = true;
        return true;
      }

      var isStable;
      if (keyword.isStable) {
        isStable = keyword.isStable(lastState, newState);
      } else {
        isStable = stableState(lastState, newState);
      }

      if (isStable) {
        if (keyword.rerender) {
          var newEnv = keyword.rerender(morph, env, scope, params, hash, template, inverse, visitor);
          env = newEnv || env;
        }
        validateChildMorphs(env, morph, visitor);
        return true;
      } else {
        clearMorph(morph, env, false);
      }

      // If the node is unstable, re-render from scratch
      if (keyword.render) {
        keyword.render(morph, env, scope, params, hash, template, inverse, visitor);
        morph.rendered = true;
        return true;
      }
    }

    function stableState(oldState, newState) {
      if (keyLength(oldState) !== keyLength(newState)) { return false; }

      for (var prop in oldState) {
        if (oldState[prop] !== newState[prop]) { return false; }
      }

      return true;
    }

    function linkRenderNode(/* morph, env, scope, params, hash */) {
      return;
    }

    __exports__.linkRenderNode = linkRenderNode;/**
      Host Hook: inline

      @param {RenderNode} renderNode
      @param {Environment} env
      @param {Scope} scope
      @param {String} path
      @param {Array} params
      @param {Hash} hash

      Corresponds to:

      ```hbs
      {{helper param1 param2 key1=val1 key2=val2}}
      ```

      This host hook is similar to the `block` host hook, but it
      invokes helpers that do not supply an attached block.

      Like the `block` hook, the helper should be invoked with:

      - `{Array} params`: the parameters passed to the helper
        in the template.
      - `{Object} hash`: an object containing the keys and values passed
        in the hash position in the template.

      The values in `params` and `hash` will already be resolved
      through a previous call to the `get` host hook.

      In general, the default implementation of `inline` should work
      for most host environments. It delegates to other host hooks
      where appropriate, and properly invokes the helper with the
      appropriate arguments.

      The default implementation of `inline` also makes `partial`
      a keyword. Instead of invoking a helper named `partial`,
      it invokes the `partial` host hook.
    */
    function inline(morph, env, scope, path, params, hash, visitor) {
      if (handleRedirect(morph, env, scope, path, params, hash, null, null, visitor)) {
        return;
      }

      var options = optionsFor(null, null, env, scope, morph);

      var helper = env.hooks.lookupHelper(env, scope, path);
      var result = env.hooks.invokeHelper(morph, env, scope, visitor, params, hash, helper, options.templates, thisFor(options.templates));

      if (result && result.value) {
        var value = result.value;
        if (morph.lastValue !== value) {
          morph.setContent(value);
        }
        morph.lastValue = value;
      }
    }

    __exports__.inline = inline;function keyword(path, morph, env, scope, params, hash, template, inverse, visitor)  {
      handleKeyword(path, morph, env, scope, params, hash, template, inverse, visitor);
    }

    __exports__.keyword = keyword;function invokeHelper(morph, env, scope, visitor, _params, _hash, helper, templates, context) {
      var params = normalizeArray(env, _params);
      var hash = normalizeObject(env, _hash);
      return { value: helper.call(context, params, hash, templates) };
    }

    __exports__.invokeHelper = invokeHelper;function normalizeArray(env, array) {
      var out = new Array(array.length);

      for (var i=0, l=array.length; i<l; i++) {
        out[i] = env.hooks.getValue(array[i]);
      }

      return out;
    }

    function normalizeObject(env, object) {
      var out = {};

      for (var prop in object)  {
        out[prop] = env.hooks.getValue(object[prop]);
      }

      return out;
    }

    function classify(/* env, scope, path */) {
      return null;
    }

    __exports__.classify = classify;var keywords = {
      partial: function(morph, env, scope, params) {
        var value = env.hooks.partial(morph, env, scope, params[0]);
        morph.setContent(value);
        return true;
      },

      yield: function(morph, env, scope, params, hash, template, inverse, visitor) {
        // the current scope is provided purely for the creation of shadow
        // scopes; it should not be provided to user code.
        scope.block(env, params, morph, scope, visitor);
        return true;
      }
    };
    __exports__.keywords = keywords;
    /**
      Host Hook: partial

      @param {RenderNode} renderNode
      @param {Environment} env
      @param {Scope} scope
      @param {String} path

      Corresponds to:

      ```hbs
      {{partial "location"}}
      ```

      This host hook is invoked by the default implementation of
      the `inline` hook. This makes `partial` a keyword in an
      HTMLBars environment using the default `inline` host hook.

      It is implemented as a host hook so that it can retrieve
      the named partial out of the `Environment`. Helpers, in
      contrast, only have access to the values passed in to them,
      and not to the ambient lexical environment.

      The host hook should invoke the referenced partial with
      the ambient `self`.
    */
    function partial(renderNode, env, scope, path) {
      var template = env.partials[path];
      return template.render(scope.self, env, {}).fragment;
    }

    __exports__.partial = partial;/**
      Host hook: range

      @param {RenderNode} renderNode
      @param {Environment} env
      @param {Scope} scope
      @param {any} value

      Corresponds to:

      ```hbs
      {{content}}
      {{{unescaped}}}
      ```

      This hook is responsible for updating a render node
      that represents a range of content with a value.
    */
    function range(morph, env, scope, path, value, visitor) {
      if (handleRedirect(morph, env, scope, path, [value], {}, null, null, visitor)) {
        return;
      }

      value = env.hooks.getValue(value);

      if (morph.lastValue !== value) {
        morph.setContent(value);
      }

      morph.lastValue = value;
    }

    __exports__.range = range;/**
      Host hook: element

      @param {RenderNode} renderNode
      @param {Environment} env
      @param {Scope} scope
      @param {String} path
      @param {Array} params
      @param {Hash} hash

      Corresponds to:

      ```hbs
      <div {{bind-attr foo=bar}}></div>
      ```

      This hook is responsible for invoking a helper that
      modifies an element.

      Its purpose is largely legacy support for awkward
      idioms that became common when using the string-based
      Handlebars engine.

      Most of the uses of the `element` hook are expected
      to be superseded by component syntax and the
      `attribute` hook.
    */
    function element(morph, env, scope, path, params, hash, visitor) {
      if (handleRedirect(morph, env, scope, path, params, hash, null, null, visitor)) {
        return;
      }

      var helper = env.hooks.lookupHelper(env, scope, path);
      if (helper) {
        env.hooks.invokeHelper(null, env, scope, null, params, hash, helper, { element: morph.element });
      }
    }

    __exports__.element = element;/**
      Host hook: attribute

      @param {RenderNode} renderNode
      @param {Environment} env
      @param {String} name
      @param {any} value

      Corresponds to:

      ```hbs
      <div foo={{bar}}></div>
      ```

      This hook is responsible for updating a render node
      that represents an element's attribute with a value.

      It receives the name of the attribute as well as an
      already-resolved value, and should update the render
      node with the value if appropriate.
    */
    function attribute(morph, env, scope, name, value) {
      value = env.hooks.getValue(value);

      if (morph.lastValue !== value) {
        morph.setContent(value);
      }

      morph.lastValue = value;
    }

    __exports__.attribute = attribute;function subexpr(env, scope, helperName, params, hash) {
      var helper = env.hooks.lookupHelper(env, scope, helperName);
      var result = env.hooks.invokeHelper(null, env, scope, null, params, hash, helper, {});
      if (result && result.value) { return result.value; }
    }

    __exports__.subexpr = subexpr;/**
      Host Hook: get

      @param {Environment} env
      @param {Scope} scope
      @param {String} path

      Corresponds to:

      ```hbs
      {{foo.bar}}
        ^

      {{helper foo.bar key=value}}
               ^           ^
      ```

      This hook is the "leaf" hook of the system. It is used to
      resolve a path relative to the current scope.
    */
    function get(env, scope, path) {
      if (path === '') {
        return scope.self;
      }

      var keys = path.split('.');
      var value = env.hooks.getRoot(scope, keys[0])[0];

      for (var i = 1; i < keys.length; i++) {
        if (value) {
          value = env.hooks.getChild(value, keys[i]);
        } else {
          break;
        }
      }

      return value;
    }

    __exports__.get = get;function getRoot(scope, key) {
      if (scope.localPresent[key]) {
        return [scope.locals[key]];
      } else if (scope.self) {
        return [scope.self[key]];
      } else {
        return [undefined];
      }
    }

    __exports__.getRoot = getRoot;function getChild(value, key) {
      return value[key];
    }

    __exports__.getChild = getChild;function getValue(value) {
      return value;
    }

    __exports__.getValue = getValue;function component(morph, env, scope, tagName, attrs, template, visitor) {
      if (env.hooks.hasHelper(env, scope, tagName)) {
        return env.hooks.block(morph, env, scope, tagName, [], attrs, template, null, visitor);
      }

      componentFallback(morph, env, scope, tagName, attrs, template);
    }

    __exports__.component = component;function concat(env, params) {
      var value = "";
      for (var i = 0, l = params.length; i < l; i++) {
        value += env.hooks.getValue(params[i]);
      }
      return value;
    }

    __exports__.concat = concat;function componentFallback(morph, env, scope, tagName, attrs, template) {
      var element = env.dom.createElement(tagName);
      for (var name in attrs) {
        element.setAttribute(name, env.hooks.getValue(attrs[name]));
      }
      var fragment = render(template, env, scope, {}).fragment;
      element.appendChild(fragment);
      morph.setNode(element);
    }

    function hasHelper(env, scope, helperName) {
      return env.helpers[helperName] !== undefined;
    }

    __exports__.hasHelper = hasHelper;function lookupHelper(env, scope, helperName) {
      return env.helpers[helperName];
    }

    __exports__.lookupHelper = lookupHelper;function bindScope(/* env, scope */) {
      // this function is used to handle host-specified extensions to scope
      // other than `self`, `locals` and `block`.
    }

    __exports__.bindScope = bindScope;function updateScope(env, scope) {
      env.hooks.bindScope(env, scope);
    }

    __exports__.updateScope = updateScope;__exports__["default"] = {
      // fundamental hooks that you will likely want to override
      bindLocal: bindLocal,
      bindSelf: bindSelf,
      bindScope: bindScope,
      classify: classify,
      component: component,
      concat: concat,
      createFreshScope: createFreshScope,
      getChild: getChild,
      getRoot: getRoot,
      getValue: getValue,
      keywords: keywords,
      linkRenderNode: linkRenderNode,
      partial: partial,
      subexpr: subexpr,

      // fundamental hooks with good default behavior
      bindBlock: bindBlock,
      bindShadowScope: bindShadowScope,
      updateLocal: updateLocal,
      updateSelf: updateSelf,
      updateScope: updateScope,
      createChildScope: createChildScope,
      hasHelper: hasHelper,
      lookupHelper: lookupHelper,
      invokeHelper: invokeHelper,
      cleanupRenderNode: null,
      destroyRenderNode: null,
      willCleanupTree: null,
      didCleanupTree: null,

      // derived hooks
      attribute: attribute,
      block: block,
      createScope: createScope,
      element: element,
      get: get,
      inline: inline,
      range: range,
      keyword: keyword
    };
  });
define("htmlbars-runtime/morph",
  ["../morph-range","../htmlbars-util/object-utils","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var MorphBase = __dependency1__["default"];
    var createObject = __dependency2__.createObject;

    function HTMLBarsMorph(domHelper, contextualElement) {
      this.super$constructor(domHelper, contextualElement);

      this.state = {};
      this.ownerNode = null;
      this.isDirty = false;
      this.isSubtreeDirty = false;
      this.lastYielded = null;
      this.lastResult = null;
      this.lastValue = null;
      this.morphList = null;
      this.morphMap = null;
      this.key = null;
      this.linkedParams = null;
      this.rendered = false;
    }

    HTMLBarsMorph.empty = function(domHelper, contextualElement) {
      var morph = new HTMLBarsMorph(domHelper, contextualElement);
      morph.clear();
      return morph;
    };

    HTMLBarsMorph.create = function (domHelper, contextualElement, node) {
      var morph = new HTMLBarsMorph(domHelper, contextualElement);
      morph.setNode(node);
      return morph;
    };

    HTMLBarsMorph.attach = function (domHelper, contextualElement, firstNode, lastNode) {
      var morph = new HTMLBarsMorph(domHelper, contextualElement);
      morph.setRange(firstNode, lastNode);
      return morph;
    };

    var prototype = HTMLBarsMorph.prototype = createObject(MorphBase.prototype);
    prototype.constructor = HTMLBarsMorph;
    prototype.super$constructor = MorphBase;

    __exports__["default"] = HTMLBarsMorph;
  });
define("htmlbars-runtime/render",
  ["../htmlbars-util/array-utils","../htmlbars-util/morph-utils","./expression-visitor","./morph","../htmlbars-util/template-utils","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __dependency5__, __exports__) {
    "use strict";
    var forEach = __dependency1__.forEach;
    var visitChildren = __dependency2__.visitChildren;
    var ExpressionVisitor = __dependency3__["default"];
    var AlwaysDirtyVisitor = __dependency3__.AlwaysDirtyVisitor;
    var Morph = __dependency4__["default"];
    var clearMorph = __dependency5__.clearMorph;

    __exports__["default"] = function render(template, env, scope, options) {
      var dom = env.dom;
      var contextualElement;

      if (options) {
        if (options.renderNode) {
          contextualElement = options.renderNode.contextualElement;
        } else if (options.contextualElement) {
          contextualElement = options.contextualElement;
        }
      }

      dom.detectNamespace(contextualElement);

      var renderResult = RenderResult.build(env, scope, template, options, contextualElement);
      renderResult.render();

      return renderResult;
    }

    function RenderResult(env, scope, options, rootNode, nodes, fragment, template, shouldSetContent) {
      this.root = rootNode;
      this.fragment = fragment;

      this.nodes = nodes;
      this.template = template;
      this.env = env;
      this.scope = scope;
      this.shouldSetContent = shouldSetContent;

      this.bindScope();

      if (options.self !== undefined) { this.bindSelf(options.self); }
      if (options.blockArguments !== undefined) { this.bindLocals(options.blockArguments); }
    }

    RenderResult.build = function(env, scope, template, options, contextualElement) {
      var dom = env.dom;
      var fragment = getCachedFragment(template, env);
      var nodes = template.buildRenderNodes(dom, fragment, contextualElement);

      var rootNode, ownerNode, shouldSetContent;

      if (options && options.renderNode) {
        rootNode = options.renderNode;
        ownerNode = rootNode.ownerNode;
        shouldSetContent = true;
      } else {
        rootNode = dom.createMorph(null, fragment.firstChild, fragment.lastChild, contextualElement);
        ownerNode = rootNode;
        initializeNode(rootNode, ownerNode);
        shouldSetContent = false;
      }

      if (rootNode.childNodes) {
        visitChildren(rootNode.childNodes, function(node) {
          clearMorph(node, env, true);
        });
      }

      rootNode.childNodes = nodes;

      forEach(nodes, function(node) {
        initializeNode(node, ownerNode);
      });

      return new RenderResult(env, scope, options, rootNode, nodes, fragment, template, shouldSetContent);
    };

    function manualElement(tagName, attributes) {
      var statements = [];

      for (var key in attributes) {
        if (typeof attributes[key] === 'string') { continue; }
        statements.push(["attribute", key, attributes[key]]);
      }

      statements.push(['content', 'yield']);

      var template = {
        isHTMLBars: true,
        revision: "HTMLBars@v0.12.0",
        arity: 0,
        cachedFragment: null,
        hasRendered: false,
        buildFragment: function buildFragment(dom) {
          var el0 = dom.createDocumentFragment();
          var el1 = dom.createElement(tagName);

          for (var key in attributes) {
            if (typeof attributes[key] !== 'string') { continue; }
            dom.setAttribute(el1, key, attributes[key]);
          }

          var el2 = dom.createComment("");
          dom.appendChild(el1, el2);
          dom.appendChild(el0, el1);
          return el0;
        },
        buildRenderNodes: function buildRenderNodes(dom, fragment) {
          var element = dom.childAt(fragment, [0]);
          var morphs = [];

          for (var key in attributes) {
            if (typeof attributes[key] === 'string') { continue; }
            morphs.push(dom.createAttrMorph(element, key));
          }

          morphs.push(dom.createMorphAt(element, 0, 0));
          return morphs;
        },
        statements: statements,
        locals: [],
        templates: []
      };

      return template;
    }

    __exports__.manualElement = manualElement;RenderResult.prototype.render = function() {
      this.root.lastResult = this;
      this.root.rendered = true;
      this.populateNodes(AlwaysDirtyVisitor);

      if (this.shouldSetContent) {
        this.root.setContent(this.fragment);
      }
    };

    RenderResult.prototype.dirty = function() {
      visitChildren([this.root], function(node) { node.isDirty = true; });
    };

    RenderResult.prototype.revalidate = function(env, self, blockArguments, scope) {
      this.revalidateWith(env, scope, self, blockArguments, ExpressionVisitor);
    };

    RenderResult.prototype.rerender = function(env, self, blockArguments, scope) {
      this.revalidateWith(env, scope, self, blockArguments, AlwaysDirtyVisitor);
    };

    RenderResult.prototype.revalidateWith = function(env, scope, self, blockArguments, visitor) {
      if (env !== undefined) { this.env = env; }
      if (scope !== undefined) { this.scope = scope; }
      this.updateScope();

      if (self !== undefined) { this.updateSelf(self); }
      if (blockArguments !== undefined) { this.updateLocals(blockArguments); }

      this.populateNodes(visitor);
    };

    RenderResult.prototype.destroy = function() {
      var rootNode = this.root;
      clearMorph(rootNode, this.env, true);
    };

    RenderResult.prototype.populateNodes = function(visitor) {
      var env = this.env;
      var scope = this.scope;
      var template = this.template;
      var nodes = this.nodes;
      var statements = template.statements;
      var i, l;

      for (i=0, l=statements.length; i<l; i++) {
        var statement = statements[i];
        var morph = nodes[i];

        switch (statement[0]) {
          case 'block': visitor.block(statement, morph, env, scope, template, visitor); break;
          case 'inline': visitor.inline(statement, morph, env, scope, visitor); break;
          case 'content': visitor.content(statement, morph, env, scope, visitor); break;
          case 'element': visitor.element(statement, morph, env, scope, template, visitor); break;
          case 'attribute': visitor.attribute(statement, morph, env, scope); break;
          case 'component': visitor.component(statement, morph, env, scope, template, visitor); break;
        }
      }
    };

    RenderResult.prototype.bindScope = function() {
      this.env.hooks.bindScope(this.env, this.scope);
    };

    RenderResult.prototype.updateScope = function() {
      this.env.hooks.updateScope(this.env, this.scope);
    };

    RenderResult.prototype.bindSelf = function(self) {
      this.env.hooks.bindSelf(this.env, this.scope, self);
    };

    RenderResult.prototype.updateSelf = function(self) {
      this.env.hooks.updateSelf(this.env, this.scope, self);
    };

    RenderResult.prototype.bindLocals = function(blockArguments) {
      var localNames = this.template.locals;

      for (var i=0, l=localNames.length; i<l; i++) {
        this.env.hooks.bindLocal(this.env, this.scope, localNames[i], blockArguments[i]);
      }
    };

    RenderResult.prototype.updateLocals = function(blockArguments) {
      var localNames = this.template.locals;

      for (var i=0, l=localNames.length; i<l; i++) {
        this.env.hooks.updateLocal(this.env, this.scope, localNames[i], blockArguments[i]);
      }
    };

    function initializeNode(node, owner) {
      node.ownerNode = owner;
    }

    function createChildMorph(dom, parentMorph, contextualElement) {
      var morph = Morph.empty(dom, contextualElement || parentMorph.contextualElement);
      initializeNode(morph, parentMorph.ownerNode);
      return morph;
    }

    __exports__.createChildMorph = createChildMorph;function getCachedFragment(template, env) {
      var dom = env.dom, fragment;
      if (env.useFragmentCache && dom.canClone) {
        if (template.cachedFragment === null) {
          fragment = template.buildFragment(dom);
          if (template.hasRendered) {
            template.cachedFragment = fragment;
          } else {
            template.hasRendered = true;
          }
        }
        if (template.cachedFragment) {
          fragment = dom.cloneNode(template.cachedFragment, true);
        }
      } else if (!fragment) {
        fragment = template.buildFragment(dom);
      }

      return fragment;
    }

    __exports__.getCachedFragment = getCachedFragment;
  });
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
define("morph-attr",
  ["./morph-attr/sanitize-attribute-value","./dom-helper/prop","./dom-helper/build-html-dom","./htmlbars-util","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __exports__) {
    "use strict";
    var sanitizeAttributeValue = __dependency1__.sanitizeAttributeValue;
    var isAttrRemovalValue = __dependency2__.isAttrRemovalValue;
    var normalizeProperty = __dependency2__.normalizeProperty;
    var svgNamespace = __dependency3__.svgNamespace;
    var getAttrNamespace = __dependency4__.getAttrNamespace;

    function updateProperty(value) {
      this.domHelper.setPropertyStrict(this.element, this.attrName, value);
    }

    function updateAttribute(value) {
      if (isAttrRemovalValue(value)) {
        this.domHelper.removeAttribute(this.element, this.attrName);
      } else {
        this.domHelper.setAttribute(this.element, this.attrName, value);
      }
    }

    function updateAttributeNS(value) {
      if (isAttrRemovalValue(value)) {
        this.domHelper.removeAttribute(this.element, this.attrName);
      } else {
        this.domHelper.setAttributeNS(this.element, this.namespace, this.attrName, value);
      }
    }

    function AttrMorph(element, attrName, domHelper, namespace) {
      this.element = element;
      this.domHelper = domHelper;
      this.namespace = namespace !== undefined ? namespace : getAttrNamespace(attrName);
      this.state = {};
      this.isDirty = false;
      this.escaped = true;
      this.lastValue = null;
      this.linkedParams = null;
      this.rendered = false;

      var normalizedAttrName = normalizeProperty(this.element, attrName);
      if (this.namespace) {
        this._update = updateAttributeNS;
        this.attrName = attrName;
      } else {
        if (element.namespaceURI === svgNamespace || attrName === 'style' || !normalizedAttrName) {
          this.attrName = attrName;
          this._update = updateAttribute;
        } else {
          this.attrName = normalizedAttrName;
          this._update = updateProperty;
        }
      }
    }

    AttrMorph.prototype.setContent = function (value) {
      if (this.escaped) {
        var sanitized = sanitizeAttributeValue(this.domHelper, this.element, this.attrName, value);
        this._update(sanitized, this.namespace);
      } else {
        this._update(value, this.namespace);
      }
    };

    __exports__["default"] = AttrMorph;

    __exports__.sanitizeAttributeValue = sanitizeAttributeValue;
  });
define("morph-attr/sanitize-attribute-value",
  ["exports"],
  function(__exports__) {
    "use strict";
    /* jshint scripturl:true */

    var badProtocols = {
      'javascript:': true,
      'vbscript:': true
    };

    var badTags = {
      'A': true,
      'BODY': true,
      'LINK': true,
      'IMG': true,
      'IFRAME': true,
      'BASE': true
    };

    var badTagsForDataURI = {
      'EMBED': true
    };

    var badAttributes = {
      'href': true,
      'src': true,
      'background': true
    };
    __exports__.badAttributes = badAttributes;
    var badAttributesForDataURI = {
      'src': true
    };

    function sanitizeAttributeValue(dom, element, attribute, value) {
      var tagName;

      if (!element) {
        tagName = null;
      } else {
        tagName = element.tagName.toUpperCase();
      }

      if (value && value.toHTML) {
        return value.toHTML();
      }

      if ((tagName === null || badTags[tagName]) && badAttributes[attribute]) {
        var protocol = dom.protocolForURL(value);
        if (badProtocols[protocol] === true) {
          return 'unsafe:' + value;
        }
      }

      if (badTagsForDataURI[tagName] && badAttributesForDataURI[attribute]) {
        return 'unsafe:' + value;
      }

      return value;
    }

    __exports__.sanitizeAttributeValue = sanitizeAttributeValue;
  });
define("morph-range",
  ["./morph-range/utils","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var clear = __dependency1__.clear;
    var insertBefore = __dependency1__.insertBefore;

    // constructor just initializes the fields
    // use one of the static initializers to create a valid morph.
    function Morph(domHelper, contextualElement) {
      this.domHelper = domHelper;
      // context if content if current content is detached
      this.contextualElement = contextualElement;
      // inclusive range of morph
      // these should be nodeType 1, 3, or 8
      this.firstNode = null;
      this.lastNode  = null;

      // flag to force text to setContent to be treated as html
      this.parseTextAsHTML = false;

      // morph list graph
      this.parentMorphList = null;
      this.previousMorph   = null;
      this.nextMorph       = null;
    }

    Morph.empty = function (domHelper, contextualElement) {
      var morph = new Morph(domHelper, contextualElement);
      morph.clear();
      return morph;
    };

    Morph.create = function (domHelper, contextualElement, node) {
      var morph = new Morph(domHelper, contextualElement);
      morph.setNode(node);
      return morph;
    };

    Morph.attach = function (domHelper, contextualElement, firstNode, lastNode) {
      var morph = new Morph(domHelper, contextualElement);
      morph.setRange(firstNode, lastNode);
      return morph;
    };

    Morph.prototype.setContent = function Morph$setContent(content) {
      if (content === null || content === undefined) {
        return this.clear();
      }

      var type = typeof content;
      switch (type) {
        case 'string':
          if (this.parseTextAsHTML) {
            return this.setHTML(content);
          }
          return this.setText(content);
        case 'object':
          if (typeof content.nodeType === 'number') {
            return this.setNode(content);
          }
          /* Handlebars.SafeString */
          if (typeof content.string === 'string') {
            return this.setHTML(content.string);
          }
          if (this.parseTextAsHTML) {
            return this.setHTML(content.toString());
          }
          /* falls through */
        case 'boolean':
        case 'number':
          return this.setText(content.toString());
        default:
          throw new TypeError('unsupported content');
      }
    };

    Morph.prototype.clear = function Morph$clear() {
      var node = this.setNode(this.domHelper.createComment(''));
      return node;
    };

    Morph.prototype.setText = function Morph$setText(text) {
      var firstNode = this.firstNode;
      var lastNode = this.lastNode;

      if (firstNode &&
          lastNode === firstNode &&
          firstNode.nodeType === 3) {
        firstNode.nodeValue = text;
        return firstNode;
      }

      return this.setNode(
        text ? this.domHelper.createTextNode(text) : this.domHelper.createComment('')
      );
    };

    Morph.prototype.setNode = function Morph$setNode(newNode) {
      var firstNode, lastNode;
      switch (newNode.nodeType) {
        case 3:
          firstNode = newNode;
          lastNode = newNode;
          break;
        case 11:
          firstNode = newNode.firstChild;
          lastNode = newNode.lastChild;
          if (firstNode === null) {
            firstNode = this.domHelper.createComment('');
            newNode.appendChild(firstNode);
            lastNode = firstNode;
          }
          break;
        default:
          firstNode = newNode;
          lastNode = newNode;
          break;
      }

      this.setRange(firstNode, lastNode);

      return newNode;
    };

    Morph.prototype.setRange = function (firstNode, lastNode) {
      var previousFirstNode = this.firstNode;
      if (previousFirstNode !== null) {

        var parentNode = previousFirstNode.parentNode;
        if (parentNode !== null) {
          insertBefore(parentNode, firstNode, lastNode, previousFirstNode);
          clear(parentNode, previousFirstNode, this.lastNode);
        }
      }

      this.firstNode = firstNode;
      this.lastNode = lastNode;

      if (this.parentMorphList) {
        this._syncFirstNode();
        this._syncLastNode();
      }
    };

    Morph.prototype.destroy = function Morph$destroy() {
      this.unlink();

      var firstNode = this.firstNode;
      var lastNode = this.lastNode;
      var parentNode = firstNode && firstNode.parentNode;

      this.firstNode = null;
      this.lastNode = null;

      clear(parentNode, firstNode, lastNode);
    };

    Morph.prototype.unlink = function Morph$unlink() {
      var parentMorphList = this.parentMorphList;
      var previousMorph = this.previousMorph;
      var nextMorph = this.nextMorph;

      if (previousMorph) {
        if (nextMorph) {
          previousMorph.nextMorph = nextMorph;
          nextMorph.previousMorph = previousMorph;
        } else {
          previousMorph.nextMorph = null;
          parentMorphList.lastChildMorph = previousMorph;
        }
      } else {
        if (nextMorph) {
          nextMorph.previousMorph = null;
          parentMorphList.firstChildMorph = nextMorph;
        } else if (parentMorphList) {
          parentMorphList.lastChildMorph = parentMorphList.firstChildMorph = null;
        }
      }

      this.parentMorphList = null;
      this.nextMorph = null;
      this.previousMorph = null;

      if (parentMorphList && parentMorphList.mountedMorph) {
        if (!parentMorphList.firstChildMorph) {
          // list is empty
          parentMorphList.mountedMorph.clear();
          return;
        } else {
          parentMorphList.firstChildMorph._syncFirstNode();
          parentMorphList.lastChildMorph._syncLastNode();
        }
      }
    };

    Morph.prototype.setHTML = function(text) {
      var fragment = this.domHelper.parseHTML(text, this.contextualElement);
      return this.setNode(fragment);
    };

    Morph.prototype.setMorphList = function Morph$appendMorphList(morphList) {
      morphList.mountedMorph = this;
      this.clear();

      var originalFirstNode = this.firstNode;

      if (morphList.firstChildMorph) {
        this.firstNode = morphList.firstChildMorph.firstNode;
        this.lastNode = morphList.lastChildMorph.lastNode;

        var current = morphList.firstChildMorph;

        while (current) {
          var next = current.nextMorph;
          current.insertBeforeNode(originalFirstNode, null);
          current = next;
        }
        originalFirstNode.parentNode.removeChild(originalFirstNode);
      }
    };

    Morph.prototype._syncFirstNode = function Morph$syncFirstNode() {
      var morph = this;
      var parentMorphList;
      while (parentMorphList = morph.parentMorphList) {
        if (parentMorphList.mountedMorph === null) {
          break;
        }
        if (morph !== parentMorphList.firstChildMorph) {
          break;
        }
        if (morph.firstNode === parentMorphList.mountedMorph.firstNode) {
          break;
        }

        parentMorphList.mountedMorph.firstNode = morph.firstNode;

        morph = parentMorphList.mountedMorph;
      }
    };

    Morph.prototype._syncLastNode = function Morph$syncLastNode() {
      var morph = this;
      var parentMorphList;
      while (parentMorphList = morph.parentMorphList) {
        if (parentMorphList.mountedMorph === null) {
          break;
        }
        if (morph !== parentMorphList.lastChildMorph) {
          break;
        }
        if (morph.lastNode === parentMorphList.mountedMorph.lastNode) {
          break;
        }

        parentMorphList.mountedMorph.lastNode = morph.lastNode;

        morph = parentMorphList.mountedMorph;
      }
    };

    Morph.prototype.insertBeforeNode = function Morph$insertBeforeNode(parent, reference) {
      var current = this.firstNode;

      while (current) {
        var next = current.nextSibling;
        parent.insertBefore(current, reference);
        current = next;
      }
    };

    Morph.prototype.appendToNode = function Morph$appendToNode(parent) {
      this.insertBeforeNode(parent, null);
    };

    __exports__["default"] = Morph;
  });
define("morph-range.umd",
  ["./morph-range"],
  function(__dependency1__) {
    "use strict";
    var Morph = __dependency1__["default"];

    (function (root, factory) {
      if (typeof define === 'function' && define.amd) {
        define([], factory);
      } else if (typeof exports === 'object') {
        module.exports = factory();
      } else {
        root.Morph = factory();
      }
    }(this, function () {
      return Morph;
    }));
  });
define("morph-range/morph-list",
  ["./utils","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var clear = __dependency1__.clear;
    var insertBefore = __dependency1__.insertBefore;

    function MorphList() {
      // morph graph
      this.firstChildMorph = null;
      this.lastChildMorph  = null;

      this.mountedMorph = null;
    }

    var prototype = MorphList.prototype;

    prototype.clear = function MorphList$clear() {
      var current = this.firstChildMorph;

      while (current) {
        var next = current.nextMorph;
        current.previousMorph = null;
        current.nextMorph = null;
        current.parentMorphList = null;
        current = next;
      }

      this.firstChildMorph = this.lastChildMorph = null;
    };

    prototype.destroy = function MorphList$destroy() {
    };

    prototype.appendMorph = function MorphList$appendMorph(morph) {
      this.insertBeforeMorph(morph, null);
    };

    prototype.insertBeforeMorph = function MorphList$insertBeforeMorph(morph, referenceMorph) {
      if (morph.parentMorphList !== null) {
        morph.unlink();
      }
      if (referenceMorph && referenceMorph.parentMorphList !== this) {
        throw new Error('The morph before which the new morph is to be inserted is not a child of this morph.');
      }

      var mountedMorph = this.mountedMorph;

      if (mountedMorph) {

        var parentNode = mountedMorph.firstNode.parentNode;
        var referenceNode = referenceMorph ? referenceMorph.firstNode : mountedMorph.lastNode.nextSibling;

        insertBefore(
          parentNode,
          morph.firstNode,
          morph.lastNode,
          referenceNode
        );

        // was not in list mode replace current content
        if (!this.firstChildMorph) {
          clear(this.mountedMorph.firstNode.parentNode,
                this.mountedMorph.firstNode,
                this.mountedMorph.lastNode);
        }
      }

      morph.parentMorphList = this;

      var previousMorph = referenceMorph ? referenceMorph.previousMorph : this.lastChildMorph;
      if (previousMorph) {
        previousMorph.nextMorph = morph;
        morph.previousMorph = previousMorph;
      } else {
        this.firstChildMorph = morph;
      }

      if (referenceMorph) {
        referenceMorph.previousMorph = morph;
        morph.nextMorph = referenceMorph;
      } else {
        this.lastChildMorph = morph;
      }

      this.firstChildMorph._syncFirstNode();
      this.lastChildMorph._syncLastNode();
    };

    prototype.removeChildMorph = function MorphList$removeChildMorph(morph) {
      if (morph.parentMorphList !== this) {
        throw new Error("Cannot remove a morph from a parent it is not inside of");
      }

      morph.destroy();
    };

    __exports__["default"] = MorphList;
  });
define("morph-range/morph-list.umd",
  ["./morph-list"],
  function(__dependency1__) {
    "use strict";
    var MorphList = __dependency1__["default"];

    (function (root, factory) {
      if (typeof define === 'function' && define.amd) {
        define([], factory);
      } else if (typeof exports === 'object') {
        module.exports = factory();
      } else {
        root.MorphList = factory();
      }
    }(this, function () {
      return MorphList;
    }));
  });
define("morph-range/utils",
  ["exports"],
  function(__exports__) {
    "use strict";
    // inclusive of both nodes
    function clear(parentNode, firstNode, lastNode) {
      if (!parentNode) { return; }

      var node = firstNode;
      var nextNode;
      do {
        nextNode = node.nextSibling;
        parentNode.removeChild(node);
        if (node === lastNode) {
          break;
        }
        node = nextNode;
      } while (node);
    }

    __exports__.clear = clear;function insertBefore(parentNode, firstNode, lastNode, _refNode) {
      var node = lastNode;
      var refNode = _refNode;
      var prevNode;
      do {
        prevNode = node.previousSibling;
        parentNode.insertBefore(node, refNode);
        if (node === firstNode) {
          break;
        }
        refNode = node;
        node = prevNode;
      } while (node);
    }

    __exports__.insertBefore = insertBefore;
  });