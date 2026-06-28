import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/** Assigned route ids for the toolbar-selected bus (for assign UI indicators). */
export function useBusAssignedRoutes(selectedBusId) {
  const [assignedRouteIds, setAssignedRouteIds] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!selectedBusId || selectedBusId === 'bus-1') {
      setAssignedRouteIds([]);
      return;
    }
    setLoading(true);
    try {
      const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/routes`);
      setAssignedRouteIds(json.assignedRouteIds ?? []);
    } catch {
      setAssignedRouteIds([]);
    } finally {
      setLoading(false);
    }
  }, [selectedBusId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const assignedSet = new Set(assignedRouteIds);
  const isAssigned = (routeId) => assignedSet.has(routeId);

  return { assignedRouteIds, assignedSet, isAssigned, loading, refresh };
}
