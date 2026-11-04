import {
  createContext,
  useRef,
  useContext,
  type ReactNode,
  type ComponentProps,
} from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { SidebarMenuItem } from "./components/ui/sidebar.tsx";

const SortContext = createContext<ReturnType<typeof useSortable> | null>(null);

export function SidebarSort({
  ids,
  disabled,
  onReorder,
  children,
  t,
}: {
  ids: string[];
  disabled: boolean;
  onReorder: (ids: string[]) => void;
  children: ReactNode;
  t: (key: string) => string;
}) {
  const moved = useRef(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 400, tolerance: 8 },
    }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const underPointer = pointerWithin(args);
        return underPointer.length ? underPointer : closestCenter(args);
      }}
      onDragStart={() => {
        moved.current = false;
      }}
      onDragMove={({ delta }) => {
        if (Math.hypot(delta.x, delta.y) > 8) moved.current = true;
      }}
      accessibility={{
        announcements: {
          onDragStart: () => t("Picked up."),
          onDragOver: () => t("Move to this position."),
          onDragEnd: () => t("Dropped."),
          onDragCancel: () => t("Reordering cancelled."),
        },
        screenReaderInstructions: {
          draggable: "",
        },
      }}
      onDragEnd={({ active, over, activatorEvent }) => {
        if (activatorEvent.type === "touchstart" && !moved.current) {
          const target = activatorEvent.target;
          if (target instanceof Element) {
            const touch = (activatorEvent as TouchEvent).touches[0];
            queueMicrotask(() =>
              target.dispatchEvent(
                new MouseEvent("contextmenu", {
                  bubbles: true,
                  cancelable: true,
                  clientX: touch?.clientX,
                  clientY: touch?.clientY,
                }),
              ),
            );
          }
          return;
        }
        if (over && active.id !== over.id)
          onReorder(
            arrayMove(
              ids,
              ids.indexOf(String(active.id)),
              ids.indexOf(String(over.id)),
            ),
          );
      }}
    >
      <SortableContext
        items={ids}
        strategy={verticalListSortingStrategy}
        disabled={disabled}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function SortableSidebarItem({
  id,
  disabled,
  children,
  ...props
}: ComponentProps<typeof SidebarMenuItem> & { id: string; disabled: boolean }) {
  const sortable = useSortable({ id, disabled });
  return (
    <SortContext.Provider value={sortable}>
      <SidebarMenuItem
        {...props}
        ref={sortable.setNodeRef}
        data-sidebar-sort-id={id}
        data-sidebar-sorting={sortable.isDragging || undefined}
        style={{
          transform: sortable.transform
            ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
            : undefined,
          transition: sortable.transition,
        }}
      >
        {children}
      </SidebarMenuItem>
    </SortContext.Provider>
  );
}

/** Attach to the existing row button, leaving its contents and click action intact. */
export function useSidebarSortHandle(enabled: boolean) {
  const sortable = useContext(SortContext);
  const touching = useRef(false);
  if (!enabled || !sortable) return {};
  return {
    ...sortable.listeners,
    ref: sortable.setActivatorNodeRef,
    // Radix's own long-press menu must not open while the finger is dragging.
    onPointerDownCapture: (event: React.PointerEvent) => {
      if (event.pointerType === "touch") event.stopPropagation();
    },
    // Only the browser menu is suppressed; the release action dispatches its own event.
    onContextMenuCapture: (event: React.MouseEvent) => {
      if (touching.current && event.nativeEvent.isTrusted) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onTouchEndCapture: () => {
      touching.current = false;
    },
    onTouchCancelCapture: () => {
      touching.current = false;
    },
    onTouchStartCapture: () => {
      touching.current = true;
    },
  };
}
