import { Dialog } from '@/components/ui/Dialog';
import { Kbd } from '@/components/ui/Kbd';
import { useUi } from './state';

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: 'Anywhere',
    rows: [
      [['⌘', 'K'], 'Command palette'],
      [['C'], 'New issue'],
      [['/'], 'Search issues'],
      [['?'], 'This list'],
      [['Esc'], 'Clear the search, the selection, then close what’s open'],
    ],
  },
  {
    title: 'Moving around a list',
    rows: [
      [['J'], 'Next issue'],
      [['K'], 'Previous issue'],
      [['Enter'], 'Open the issue'],
      [['⌘', '↵'], 'Save or post what you’re writing'],
    ],
  },
  {
    title: 'Selecting',
    rows: [
      [['⌘', 'click'], 'Add an issue to the selection'],
      [['⇧', 'click'], 'Select a range'],
      [['X'], 'Toggle the issue under the cursor'],
      [['Esc'], 'Clear the selection'],
    ],
  },
  {
    title: 'Triage',
    rows: [
      [['A'], 'Accept — move to Todo'],
      [['D'], 'Decline — move to Canceled'],
      [['E'], 'Archive'],
      [['1'], 'Urgent'],
      [['2'], 'High'],
      [['3'], 'Medium'],
      [['4'], 'Low'],
    ],
  },
  {
    title: 'Board',
    rows: [
      [['Space'], 'Pick a card up, then arrow keys to move it'],
      [['Space'], 'Drop it where it is'],
      [['Esc'], 'Put it back'],
    ],
  },
];

export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen } = useUi();
  return (
    <Dialog
      open={shortcutsOpen}
      onOpenChange={setShortcutsOpen}
      title="Keyboard shortcuts"
      width={620}
    >
      <div className="shortcuts">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            {g.rows.map(([keys, label]) => (
              <div className="shortcut-row" key={`${g.title}-${label}-${keys.join('')}`}>
                <span className="keys">
                  {keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
                <span>{label}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
