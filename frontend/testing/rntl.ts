/**
 * Render-tree helpers for RNTL tests: one copy instead of a per-file
 * styleOf / walk / countByType.
 *
 * They read `view.toJSON()` trees (host nodes: { type, props, children }) or
 * RNTL host instances (`view.getByTestId(...)`, which also carry `.props`).
 */
import { StyleSheet } from 'react-native';

export type JsonNode = {
    type?: string;
    props?: Record<string, any>;
    children?: unknown[] | null;
};

/** The flattened style of a node ({} when it has none). */
export function styleOf(node: unknown): Record<string, any> {
    const props = (node as JsonNode | null | undefined)?.props;
    return props ? (StyleSheet.flatten(props.style) as Record<string, any>) || {} : {};
}

/** Visit every host node of a toJSON() tree depth-first, in document order. */
export function walkTree(tree: unknown, visit: (node: JsonNode) => void): void {
    if (Array.isArray(tree)) {
        tree.forEach((t) => walkTree(t, visit));
        return;
    }
    if (!tree || typeof tree !== 'object') return;
    const node = tree as JsonNode;
    visit(node);
    node.children?.forEach((c) => walkTree(c, visit));
}

/** Every node of the tree matching `pred`, in document order. */
export function findNodes(tree: unknown, pred: (node: JsonNode) => boolean): JsonNode[] {
    const out: JsonNode[] = [];
    walkTree(tree, (n) => {
        if (pred(n)) out.push(n);
    });
    return out;
}

/** Every node whose flattened style matches `pred`. */
export function collectByStyle(tree: unknown, pred: (style: Record<string, any>) => boolean): JsonNode[] {
    return findNodes(tree, (n) => pred(styleOf(n)));
}

/** How many host nodes have a type containing `typeSubstr` (e.g. 'Circle' matches RNSVGCircle). */
export function countByType(tree: unknown, typeSubstr: string): number {
    return findNodes(tree, (n) => typeof n.type === 'string' && n.type.includes(typeSubstr)).length;
}

/** Every string react-native-svg draws (one RNSVGTSpan per <Text>), in document order. */
export function svgStrings(tree: unknown): string[] {
    return findNodes(
        tree,
        (n) => n.type === 'RNSVGTSpan' && typeof n.props?.content === 'string'
    ).map((n) => n.props!.content as string);
}
