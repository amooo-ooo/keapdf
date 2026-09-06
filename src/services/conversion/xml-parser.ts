/**
 * Pure TypeScript XML parser and node query utility.
 * Operates without DOMParser dependencies for 100% test and runtime portability.
 */

export interface XmlNode {
  readonly tag: string;
  readonly localName: string;
  readonly attributes: Record<string, string>;
  readonly children: XmlNode[];
  text: string;
}

/**
 * Decodes XML character references and predefined entities.
 */
export function decodeXmlEntities(input: string): string {
  if (!input.includes('&')) return input;

  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return isNaN(code) ? '' : String.fromCharCode(code);
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return isNaN(code) ? '' : String.fromCharCode(code);
    });
}

/**
 * Parses an XML string into a structured node hierarchy.
 */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = {
    tag: '#root',
    localName: '#root',
    attributes: {},
    children: [],
    text: '',
  };

  const stack: XmlNode[] = [root];
  const tagRegex = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/)?([a-zA-Z0-9_:-]+)((?:\s+[a-zA-Z0-9_:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/)?>|([^<]+)/g;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(xml)) !== null) {
    const [
      fullMatch,
      cdataContent,
      isClosingSlash,
      tagName,
      rawAttributes,
      isSelfClosingSlash,
      textContent,
    ] = match;

    const currentParent = stack[stack.length - 1];

    if (cdataContent !== undefined) {
      // CDATA block
      currentParent.text += cdataContent;
    } else if (textContent !== undefined) {
      // Plain text outside tags
      const trimmed = decodeXmlEntities(textContent);
      if (trimmed.length > 0) {
        currentParent.text += trimmed;
      }
    } else if (tagName) {
      const isClosing = isClosingSlash === '/';
      const isSelfClosing = isSelfClosingSlash === '/' || fullMatch.endsWith('/>');

      if (isClosing) {
        // Closing tag: pop until matching tag is found or root
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tag === tagName || stack[i].localName === tagName) {
            stack.length = i;
            break;
          }
        }
      } else {
        // Opening tag
        const colonIndex = tagName.indexOf(':');
        const localName = colonIndex !== -1 ? tagName.slice(colonIndex + 1) : tagName;
        const attributes: Record<string, string> = {};

        if (rawAttributes) {
          const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
          let attrMatch: RegExpExecArray | null;
          while ((attrMatch = attrRegex.exec(rawAttributes)) !== null) {
            const attrKey = attrMatch[1];
            const attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
            attributes[attrKey] = decodeXmlEntities(attrVal);
          }
        }

        const node: XmlNode = {
          tag: tagName,
          localName,
          attributes,
          children: [],
          text: '',
        };

        currentParent.children.push(node);

        if (!isSelfClosing) {
          stack.push(node);
        }
      }
    }
  }

  // Return the main document element, or the root container if empty
  return root.children[0] ?? root;
}

/**
 * Recursively finds all descendant nodes matching the given tag or local name.
 */
export function findDescendants(node: XmlNode, targetTagOrLocal: string): XmlNode[] {
  const matches: XmlNode[] = [];
  const search = targetTagOrLocal.toLowerCase();

  function traverse(current: XmlNode): void {
    for (const child of current.children) {
      if (
        child.tag.toLowerCase() === search ||
        child.localName.toLowerCase() === search
      ) {
        matches.push(child);
      }
      traverse(child);
    }
  }

  traverse(node);
  return matches;
}

/**
 * Finds direct children matching the given tag or local name.
 */
export function findChildren(node: XmlNode, targetTagOrLocal: string): XmlNode[] {
  const search = targetTagOrLocal.toLowerCase();
  return node.children.filter(
    (c) => c.tag.toLowerCase() === search || c.localName.toLowerCase() === search
  );
}

/**
 * Finds the first descendant matching the given tag or local name.
 */
export function findFirstDescendant(
  node: XmlNode,
  targetTagOrLocal: string
): XmlNode | undefined {
  const search = targetTagOrLocal.toLowerCase();

  function traverse(current: XmlNode): XmlNode | undefined {
    for (const child of current.children) {
      if (
        child.tag.toLowerCase() === search ||
        child.localName.toLowerCase() === search
      ) {
        return child;
      }
      const found = traverse(child);
      if (found) return found;
    }
    return undefined;
  }

  return traverse(node);
}

/**
 * Finds the first direct child matching the given tag or local name.
 */
export function findFirstChild(
  node: XmlNode,
  targetTagOrLocal: string
): XmlNode | undefined {
  const search = targetTagOrLocal.toLowerCase();
  return node.children.find(
    (c) => c.tag.toLowerCase() === search || c.localName.toLowerCase() === search
  );
}

/**
 * Recursively extracts and concatenates all text inside a node.
 */
export function getAllText(node: XmlNode): string {
  let result = node.text;
  for (const child of node.children) {
    result += getAllText(child);
  }
  return result.trim();
}

/**
 * Looks up an attribute value by full key or local name.
 */
export function getAttribute(node: XmlNode, keyOrLocal: string): string | undefined {
  if (node.attributes[keyOrLocal] !== undefined) {
    return node.attributes[keyOrLocal];
  }

  const search = keyOrLocal.toLowerCase();
  for (const [k, v] of Object.entries(node.attributes)) {
    if (k.toLowerCase() === search) {
      return v;
    }
    const colon = k.indexOf(':');
    if (colon !== -1 && k.slice(colon + 1).toLowerCase() === search) {
      return v;
    }
  }

  return undefined;
}
