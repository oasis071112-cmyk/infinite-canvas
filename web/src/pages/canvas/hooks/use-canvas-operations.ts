import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { applyCanvasOperations, type CanvasOperation } from "@/lib/canvas/canvas-operations";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

type CanvasOperationsParams = {
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

export function useCanvasOperations(params: CanvasOperationsParams) {
    const { nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu } = params;
    const applyOperations = useCallback((ops?: CanvasOperation[]) => {
        const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
        const generationOps = safeOps.filter((op): op is Extract<CanvasOperation, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
        const next = applyCanvasOperations(
            { nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current },
            safeOps.filter((op) => op.type !== "run_generation"),
        );
        nodesRef.current = next.nodes;
        connectionsRef.current = next.connections;
        selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
        viewportRef.current = next.viewport;
        setNodes(next.nodes);
        setConnections(next.connections);
        setSelectedNodeIds(new Set(next.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(next.viewport);
        setContextMenu(null);
        if (generationOps.length) {
            queueMicrotask(() =>
                generationOps.forEach((op) => {
                    const target = nodesRef.current.find((node) => node.id === op.nodeId);
                    const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                    void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                }),
            );
        }
        return next;
    }, []);

    return { applyOperations };
}
