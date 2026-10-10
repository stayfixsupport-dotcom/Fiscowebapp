import { useEffect, useState } from "react";
import {
  readDismissedNotificationIds,
  readNotificationIds,
  saveDismissedNotificationIds,
  saveReadNotificationIds,
} from "@/lib/notification-state";
import { supabase } from "@/integrations/supabase/client";

export function useLocalNotificationReads(scope: string) {
  const [readIds, setReadIds] = useState<string[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    setReadIds(readNotificationIds(scope));
    setDismissedIds(readDismissedNotificationIds(scope));
  }, [scope]);

  const markRead = (id: string) => {
    setReadIds((previous) => {
      const next = previous.includes(id) ? previous : [...previous, id];
      saveReadNotificationIds(scope, next);
      return next;
    });
    if (id.startsWith("db:")) {
      void supabase
        .from("notifications" as never)
        .update({ read_at: new Date().toISOString() } as never)
        .eq("id", id.slice(3));
    }
  };

  const markAllRead = (ids: string[]) => {
    setReadIds((previous) => {
      const next = [...new Set([...previous, ...ids])];
      saveReadNotificationIds(scope, next);
      return next;
    });
    const remoteIds = ids.filter((id) => id.startsWith("db:")).map((id) => id.slice(3));
    if (remoteIds.length) {
      void supabase
        .from("notifications" as never)
        .update({ read_at: new Date().toISOString() } as never)
        .in("id", remoteIds);
    }
  };

  const clearAll = async (ids: string[]) => {
    const remoteIds = ids.filter((id) => id.startsWith("db:")).map((id) => id.slice(3));
    if (remoteIds.length) {
      const { error } = await supabase
        .from("notifications" as never)
        .delete()
        .in("id", remoteIds);
      if (error) return false;
    }
    setDismissedIds((previous) => {
      const next = [...new Set([...previous, ...ids])];
      saveDismissedNotificationIds(scope, next);
      return next;
    });
    const localIds = ids.filter((id) => !id.startsWith("db:"));
    if (localIds.length) {
      setReadIds((previous) => {
        const next = [...new Set([...previous, ...localIds])];
        saveReadNotificationIds(scope, next);
        return next;
      });
    }
    return true;
  };

  return { readIds, dismissedIds, markRead, markAllRead, clearAll };
}
