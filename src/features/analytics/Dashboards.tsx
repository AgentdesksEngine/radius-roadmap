import { useState } from 'react';
import { ChevronDown, LayoutDashboard, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Dashboard, ProjectSchema, Widget, WidgetMeasure } from '@shared/types';
import { useCreateDashboard, useDeleteDashboard, useUpdateDashboard } from '@/api/hooks';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { MEASURE_LABELS, STAT_LABELS, groupableFields, newWidgetId } from './widgets';

/** The built-in page. Not a row in `dashboards` — it is the same view everyone has always had. */
export const DEFAULT_DASHBOARD_ID = 'default';

export function DashboardPicker({
  dashboards,
  currentId,
  onSelect,
}: {
  dashboards: Dashboard[];
  currentId: string;
  onSelect: (id: string) => void;
}) {
  const create = useCreateDashboard();
  const update = useUpdateDashboard();
  const remove = useDeleteDashboard();
  const toast = useToast();
  const [naming, setNaming] = useState<{ id?: string; name: string } | null>(null);

  const current = dashboards.find((d) => d.id === currentId);
  const label = current?.name ?? 'Overview';

  const submitName = () => {
    const name = naming?.name.trim();
    if (!name) return;
    if (naming?.id) {
      update.mutate(
        { id: naming.id, name },
        { onError: (e) => toast.error(`Couldn’t rename: ${e.message}`) },
      );
    } else {
      create.mutate(
        { name, widgets: [] },
        {
          onSuccess: (d) => {
            onSelect(d.id);
            toast.success(`Created “${name}”`);
          },
          onError: (e) => toast.error(`Couldn’t create dashboard: ${e.message}`),
        },
      );
    }
    setNaming(null);
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button className="dash-picker">
            <LayoutDashboard size={13} />
            {label}
            <ChevronDown size={13} />
          </button>
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>Dashboards</MenuLabel>
          <MenuItem onSelect={() => onSelect(DEFAULT_DASHBOARD_ID)} hint={currentId === DEFAULT_DASHBOARD_ID ? '✓' : undefined}>
            Overview
          </MenuItem>
          {dashboards.map((d) => (
            <MenuItem key={d.id} onSelect={() => onSelect(d.id)} hint={currentId === d.id ? '✓' : undefined}>
              {d.name}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onSelect={() => setNaming({ name: '' })}>
            <Plus /> New dashboard
          </MenuItem>
          {current && (
            <>
              <MenuItem onSelect={() => setNaming({ id: current.id, name: current.name })}>
                <Pencil /> Rename “{current.name}”
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  remove.mutate(current.id, {
                    onSuccess: () => onSelect(DEFAULT_DASHBOARD_ID),
                    onError: (e) => toast.error(`Couldn’t delete: ${e.message}`),
                  });
                }}
              >
                <Trash2 /> Delete “{current.name}”
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>

      <Dialog
        open={naming !== null}
        onOpenChange={(o) => !o && setNaming(null)}
        title={naming?.id ? 'Rename dashboard' : 'New dashboard'}
        width={420}
      >
        <input
          className="input"
          autoFocus
          placeholder="e.g. Weekly iOS review"
          value={naming?.name ?? ''}
          onChange={(e) => setNaming((n) => (n ? { ...n, name: e.target.value } : n))}
          onKeyDown={(e) => e.key === 'Enter' && submitName()}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <Button size="sm" variant="ghost" onClick={() => setNaming(null)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!naming?.name.trim()} onClick={submitName}>
            {naming?.id ? 'Rename' : 'Create'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/**
 * Adding a widget is two choices at most: which measure, and (for a breakdown or a counter)
 * which one. Deliberately not a query builder — see the plan's "Dashboard v1".
 */
export function AddWidget({ dashboard, schema }: { dashboard: Dashboard; schema: ProjectSchema | undefined }) {
  const update = useUpdateDashboard();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [measure, setMeasure] = useState<WidgetMeasure>('openByField');
  const [groupBy, setGroupBy] = useState(groupableFields(schema)[0] ?? 'Status');
  const [stat, setStat] = useState<keyof typeof STAT_LABELS>('open');

  const add = () => {
    const widget: Widget = {
      id: newWidgetId(),
      measure,
      ...(measure === 'openByField' ? { groupBy } : {}),
      ...(measure === 'stat' ? { stat } : {}),
    };
    update.mutate(
      { id: dashboard.id, widgets: [...dashboard.widgets, widget] },
      { onError: (e) => toast.error(`Couldn’t add widget: ${e.message}`) },
    );
    setOpen(false);
  };

  return (
    <>
      <Button size="sm" icon={<Plus />} onClick={() => setOpen(true)}>
        Add widget
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Add a widget" width={440}>
        <label className="dash-field">
          <span>Show</span>
          <select className="input" value={measure} onChange={(e) => setMeasure(e.target.value as WidgetMeasure)}>
            {(Object.keys(MEASURE_LABELS) as WidgetMeasure[]).map((m) => (
              <option key={m} value={m}>
                {MEASURE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>

        {measure === 'openByField' && (
          <label className="dash-field">
            <span>Grouped by</span>
            <select className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {groupableFields(schema).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        )}

        {measure === 'stat' && (
          <label className="dash-field">
            <span>Which number</span>
            <select
              className="input"
              value={stat}
              onChange={(e) => setStat(e.target.value as keyof typeof STAT_LABELS)}
            >
              {(Object.keys(STAT_LABELS) as (keyof typeof STAT_LABELS)[]).map((sKey) => (
                <option key={sKey} value={sKey}>
                  {STAT_LABELS[sKey]}
                </option>
              ))}
            </select>
          </label>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={add}>
            Add
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export function RemoveWidget({ dashboard, widgetId }: { dashboard: Dashboard; widgetId: string }) {
  const update = useUpdateDashboard();
  const toast = useToast();
  return (
    <IconButton
      label="Remove widget"
      size="sm"
      className="widget-remove"
      onClick={() =>
        update.mutate(
          { id: dashboard.id, widgets: dashboard.widgets.filter((w) => w.id !== widgetId) },
          { onError: (e) => toast.error(`Couldn’t remove widget: ${e.message}`) },
        )
      }
    >
      <X />
    </IconButton>
  );
}
