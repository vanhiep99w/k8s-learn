import { defineDocs, defineConfig } from 'fumadocs-mdx/config';
import remarkGithubAdmonitions from 'remark-github-admonitions-to-directives';
import { visit } from 'unist-util-visit';
import { remarkD2 } from '@vanhiep99w/docs-kit/d2';
import { remarkTerminalSession } from '@vanhiep99w/docs-kit/terminal-session';
import { remarkCodeWalkthrough } from '@vanhiep99w/docs-kit/code-walkthrough';
import { remarkCodeDiff } from '@vanhiep99w/docs-kit/code-diff';
import { remarkProtocolExchange } from '@vanhiep99w/docs-kit/protocol-exchange';

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

export const docs = defineDocs({
  dir: 'content/docs',
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [
      remarkGithubAdmonitions,
      remarkCalloutDirectives,
      [remarkD2, {
        cacheDir: '.next/cache/docs-kit/d2',
        sketch: false,
        scale: 1,
        interactive: true,
        defaultCaption: 'Sơ đồ',
      }],
      remarkTerminalSession,
      remarkCodeWalkthrough,
      remarkCodeDiff,
      remarkProtocolExchange,
    ],
  },
});
