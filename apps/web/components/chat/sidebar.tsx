"use client";

import { MessageSquare, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { JarvisMark } from "./message";

export function Sidebar({
  conversations,
  activeId,
  online,
  open,
  onClose,
  onNew,
  onSelect,
  onDelete,
}: {
  conversations: Conversation[];
  activeId: string | null;
  online: boolean | null;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <div
        className={cn("fixed inset-0 z-30 bg-black/60 md:hidden", open ? "block" : "hidden")}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-line bg-panel transition-transform md:static md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <JarvisMark size={30} />
          <div className="leading-tight">
            <div className="font-semibold tracking-[0.2em]">JARVIS</div>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  online === null ? "bg-muted" : online ? "bg-ok shadow-[0_0_6px_var(--color-ok)]" : "bg-bad",
                )}
              />
              {online === null ? "Connecting" : online ? "Online" : "Server offline"}
            </div>
          </div>
          <Button size="icon" className="ml-auto md:hidden" onClick={onClose} aria-label="Close menu">
            <X size={18} />
          </Button>
        </div>
        <div className="px-3 pb-2">
          <Button variant="outline" className="w-full justify-start" onClick={onNew}>
            <Plus size={16} /> New conversation
          </Button>
        </div>
        <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {conversations.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No conversations yet</p>}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer",
                c.id === activeId ? "bg-panel-2 text-fg" : "text-muted hover:bg-panel-2/60 hover:text-fg",
              )}
              onClick={() => onSelect(c.id)}
            >
              <MessageSquare size={14} className="shrink-0" />
              <span className="flex-1 truncate">{c.title}</span>
              <button
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted hover:text-bad"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
                aria-label={`Delete ${c.title}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </nav>
        <div className="border-t border-line px-4 py-3 text-xs text-muted">NVIDIA NIM first · Claude on approval</div>
      </aside>
    </>
  );
}
