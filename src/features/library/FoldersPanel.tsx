import { useMemo, useState } from "react";
import { PanelSection } from "@/components/PanelSection";
import { useCatalogStore, parentDir } from "@/store/catalogStore";
import { useUiStore } from "@/store/uiStore";
import { buildFolderMenu } from "./menus";

interface TreeNode {
  name: string; // display segment (single-child chains collapsed: "a/b")
  path: string; // absolute path of this node
  count: number; // photos in this folder and below
  children: TreeNode[];
}

/**
 * classic-style hierarchical Folders panel. The tree is derived from the
 * imported images' parent directories, rooted at their common prefix, with
 * single-child chains collapsed to keep the tree shallow. Clicking a node
 * shows that folder *and its subfolders* (the classic default behaviour).
 */
export function FoldersPanel() {
  const images = useCatalogStore((s) => s.images);
  const source = useCatalogStore((s) => s.filter.source);
  const setFilter = useCatalogStore((s) => s.setFilter);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const roots = useMemo(() => buildTree(images.map((i) => parentDir(i.path))), [images]);
  const activePath = source.kind === "folder" ? source.path : null;

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => (
    <li key={node.path}>
      <div
        className={`tree-row ${activePath === node.path ? "active" : ""}`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={() => setFilter({ source: { kind: "folder", path: node.path } })}
        onContextMenu={(e) => {
          e.preventDefault();
          useUiStore.getState().openContextMenu(e.clientX, e.clientY, buildFolderMenu(node.path));
        }}
        title={node.path}
      >
        {node.children.length > 0 ? (
          <span
            className={`tri ${collapsed.has(node.path) ? "" : "open"}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.path);
            }}
          >
            ▸
          </span>
        ) : (
          <span className="tri-spacer" />
        )}
        <span className="fname">{node.name}</span>
        <span className="fcount">{node.count}</span>
      </div>
      {node.children.length > 0 && !collapsed.has(node.path) && (
        <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>
      )}
    </li>
  );

  return (
    <PanelSection title="Folders">
      <ul className="folder-tree">{roots.map((r) => renderNode(r, 0))}</ul>
    </PanelSection>
  );
}

function buildTree(dirs: string[]): TreeNode[] {
  if (dirs.length === 0) return [];

  // Count images per leaf directory.
  const leafCounts = new Map<string, number>();
  for (const d of dirs) leafCounts.set(d, (leafCounts.get(d) ?? 0) + 1);

  // Trie over path segments.
  interface Trie {
    children: Map<string, Trie>;
    count: number; // aggregate (self + descendants)
  }
  const root: Trie = { children: new Map(), count: 0 };
  for (const [dir, count] of leafCounts) {
    const segs = dir.split("/").filter(Boolean);
    let node = root;
    node.count += count;
    for (const seg of segs) {
      let child = node.children.get(seg);
      if (!child) {
        child = { children: new Map(), count: 0 };
        node.children.set(seg, child);
      }
      child.count += count;
      node = child;
    }
  }

  // Convert to TreeNodes, collapsing single-child chains that hold no photos
  // of their own (e.g. /home/user/Pictures → one "Pictures" row, not three).
  const toNodes = (trie: Trie, basePath: string): TreeNode[] =>
    [...trie.children.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([seg, child]) => {
        let name = seg;
        let path = `${basePath}/${seg}`;
        let cur = child;
        while (cur.children.size === 1 && !leafCounts.has(path)) {
          const [[nextSeg, nextChild]] = [...cur.children.entries()];
          name = `${name}/${nextSeg}`;
          path = `${path}/${nextSeg}`;
          cur = nextChild;
        }
        return { name, path, count: cur.count, children: toNodes(cur, path) };
      });

  return toNodes(root, "");
}
