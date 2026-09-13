import { Search } from 'lucide-react';
import { Kbd } from '@/components/ui/Kbd';
import { useUi } from '../shell/state';

export function SearchBox() {
  const { filters, setFilters } = useUi();
  return (
    <div className="search">
      <Search />
      <input
        id="search-input"
        type="search"
        placeholder="Search issues"
        value={filters.query}
        onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          // First Escape clears the query, second leaves the field. Marking it handled
          // stops the shell from blurring on the first press.
          if (filters.query) {
            e.preventDefault();
            setFilters((f) => ({ ...f, query: '' }));
          }
        }}
      />
      {!filters.query && <Kbd>/</Kbd>}
    </div>
  );
}
