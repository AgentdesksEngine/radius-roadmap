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
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
      {!filters.query && <Kbd>/</Kbd>}
    </div>
  );
}
