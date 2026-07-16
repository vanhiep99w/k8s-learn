import { defineDocs, defineConfig } from 'fumadocs-mdx/config';
import remarkGithubAdmonitions from 'remark-github-admonitions-to-directives';
import { visit } from 'unist-util-visit';

function remarkCalloutDirectives() {
  const typeMap: Record<string, 'info' | 'warn' | 'error'> = {
    note: 'info',
    tip: 'info',
    warning: 'warn',
    info: 'info',
    danger: 'error',
  };
  const titleMap: Record<string, string> = {
    note: 'Ghi chú',
    tip: 'Mẹo',
    warning: 'Cảnh báo',
    info: 'Quan trọng',
    danger: 'Thận trọng',
  };

  return (tree: import('mdast').Root) => {
    visit(tree, 'containerDirective', (node: any, index, parent) => {
      if (index === undefined || !parent) return;

      const type = typeMap[node.name];
      if (!type) return;

      (parent.children as unknown[])[index] = {
        type: 'mdxJsxFlowElement',
        name: 'Callout',
        attributes: [
          {
            type: 'mdxJsxAttribute',
            name: 'type',
            value: type,
          },
          {
            type: 'mdxJsxAttribute',
            name: 'title',
            value: titleMap[node.name],
          },
        ],
        children: node.children,
      };
    });
  };
}

function remarkMermaid() {
  return (tree: import('mdast').Root) => {
    visit(tree, 'code', (node, index, parent) => {
      if (node.lang !== 'mermaid' || index === undefined || !parent) return;
      (parent.children as unknown[])[index] = {
        type: 'mdxJsxFlowElement',
        name: 'MermaidDiagram',
        attributes: [
          {
            type: 'mdxJsxAttribute',
            name: 'chart',
            value: node.value,
          },
        ],
        children: [],
      };
    });
  };
}

export const docs = defineDocs({
  dir: 'content/docs',
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkGithubAdmonitions, remarkCalloutDirectives, remarkMermaid],
  },
});
