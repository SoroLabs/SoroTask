import { renderHook, act } from '@testing-library/react';
import { useSearch } from '@/hooks/useSearch';
import type { TaskFilters } from '@/types/search';

describe('useSearch', () => {
  describe('Initial state', () => {
    it('should start with empty filters', () => {
      const { result } = renderHook(() => useSearch());
      expect(result.current.filters).toEqual({});
    });

    it('should accept initial filters', () => {
      const initial: TaskFilters = { query: 'harvest', status: ['active'] };
      const { result } = renderHook(() => useSearch(initial));
      expect(result.current.filters).toEqual(initial);
    });

    it('should have no active filters initially', () => {
      const { result } = renderHook(() => useSearch());
      expect(result.current.activeFilters).toHaveLength(0);
      expect(result.current.hasActiveFilters).toBe(false);
    });

    it('should have no saved views initially', () => {
      const { result } = renderHook(() => useSearch());
      expect(result.current.savedViews).toHaveLength(0);
    });

    it('should have no active view initially', () => {
      const { result } = renderHook(() => useSearch());
      expect(result.current.activeViewId).toBeNull();
    });
  });

  describe('setFilter', () => {
    it('should set a text query filter', () => {
      const { result } = renderHook(() => useSearch());
      act(() => {
        result.current.setFilter('query', 'harvest');
      });
      expect(result.current.filters.query).toBe('harvest');
    });

    it('should set status filter', () => {
      const { result } = renderHook(() => useSearch());
      act(() => {
        result.current.setFilter('status', ['active', 'paused']);
      });
      expect(result.current.filters.status).toEqual(['active', 'paused']);
    });

    it('should set priority filter', () => {
      const { result } = renderHook(() => useSearch());
      act(() => {
        result.current.setFilter('priority', ['high', 'critical']);
      });
      expect(result.current.filters.priority).toEqual(['high', 'critical']);
    });

    it('should remove filter when set to empty string', () => {
      const { result } = renderHook(() => useSearch({ query: 'test' }));
      act(() => {
        result.current.setFilter('query', '');
      });
      expect(result.current.filters.query).toBeUndefined();
    });

    it('should remove filter when set to empty array', () => {
      const { result } = renderHook(() => useSearch({ status: ['active'] }));
      act(() => {
        result.current.setFilter('status', []);
      });
      expect(result.current.filters.status).toBeUndefined();
    });

    it('should remove filter when set to undefined', () => {
      const { result } = renderHook(() => useSearch({ query: 'test' }));
      act(() => {
        result.current.setFilter('query', undefined);
      });
      expect(result.current.filters.query).toBeUndefined();
    });

    it('should clear active view when filter changes', () => {
      const { result } = renderHook(() => useSearch());
      // Save a view first
      act(() => {
        result.current.setFilter('query', 'test');
      });
      act(() => {
        result.current.saveView('My View');
      });
      expect(result.current.activeViewId).not.toBeNull();
      // Change filter
      act(() => {
        result.current.setFilter('query', 'other');
      });
      expect(result.current.activeViewId).toBeNull();
    });
  });

  describe('activeFilters', () => {
    it('should generate active filter for query', () => {
      const { result } = renderHook(() => useSearch({ query: 'harvest' }));
      expect(result.current.activeFilters).toHaveLength(1);
      expect(result.current.activeFilters[0].field).toBe('query');
      expect(result.current.activeFilters[0].label).toBe('Search');
      expect(result.current.activeFilters[0].displayValue).toBe('harvest');
    });

    it('should generate active filter for status', () => {
      const { result } = renderHook(() => useSearch({ status: ['active', 'paused'] }));
      expect(result.current.activeFilters).toHaveLength(1);
      expect(result.current.activeFilters[0].field).toBe('status');
      expect(result.current.activeFilters[0].displayValue).toBe('active, paused');
    });

    it('should generate multiple active filters', () => {
      const { result } = renderHook(() => useSearch({
        query: 'test',
        status: ['active'],
        priority: ['high'],
      }));
      expect(result.current.activeFilters).toHaveLength(3);
    });

    it('should have unique ids for each filter', () => {
      const { result } = renderHook(() => useSearch({
        query: 'test',
        status: ['active'],
      }));
      const ids = result.current.activeFilters.map((f) => f.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('removeFilter', () => {
    it('should remove a specific filter by id', () => {
      const { result } = renderHook(() => useSearch({ query: 'test', status: ['active'] }));
      const filterId = result.current.activeFilters.find((f) => f.field === 'query')!.id;
      act(() => {
        result.current.removeFilter(filterId);
      });
      expect(result.current.filters.query).toBeUndefined();
      expect(result.current.filters.status).toEqual(['active']);
    });

    it('should do nothing for unknown filter id', () => {
      const { result } = renderHook(() => useSearch({ query: 'test' }));
      act(() => {
        result.current.removeFilter('nonexistent-id');
      });
      expect(result.current.filters.query).toBe('test');
    });
  });

  describe('clearAllFilters', () => {
    it('should clear all filters', () => {
      const { result } = renderHook(() => useSearch({
        query: 'test',
        status: ['active'],
        priority: ['high'],
      }));
      act(() => {
        result.current.clearAllFilters();
      });
      expect(result.current.filters).toEqual({});
      expect(result.current.activeFilters).toHaveLength(0);
    });

    it('should clear active view', () => {
      const { result } = renderHook(() => useSearch({ query: 'test' }));
      act(() => {
        result.current.saveView('My View');
      });
      act(() => {
        result.current.clearAllFilters();
      });
      expect(result.current.activeViewId).toBeNull();
    });
  });

  describe('saveView', () => {
    it('should save current filters as a view', () => {
      const { result } = renderHook(() => useSearch({ query: 'test', status: ['active'] }));
      act(() => {
        result.current.saveView('My View');
      });
      expect(result.current.savedViews).toHaveLength(1);
      expect(result.current.savedViews[0].name).toBe('My View');
      expect(result.current.savedViews[0].filters).toEqual({ query: 'test', status: ['active'] });
    });

    it('should set the new view as active', () => {
      const { result } = renderHook(() => useSearch({ query: 'test' }));
      act(() => {
        result.current.saveView('My View');
      });
      expect(result.current.activeViewId).toBe(result.current.savedViews[0].id);
    });

    it('should return the created view', () => {
      const { result } = renderHook(() => useSearch({ query: 'test' }));
      let view: ReturnType<typeof result.current.saveView> | undefined;
      act(() => {
        view = result.current.saveView('My View');
      });
      expect(view).toBeDefined();
      expect(view!.name).toBe('My View');
      expect(view!.id).toBeTruthy();
    });

    it('should allow multiple saved views', () => {
      const { result } = renderHook(() => useSearch());
      act(() => {
        result.current.setFilter('query', 'view1');
        result.current.saveView('View 1');
      });
      act(() => {
        result.current.setFilter('query', 'view2');
        result.current.saveView('View 2');
      });
      expect(result.current.savedViews).toHaveLength(2);
    });
  });

  describe('loadView', () => {
    it('should load filters from a saved view', () => {
      const { result } = renderHook(() => useSearch({ query: 'test' }));
      let viewId: string;
      act(() => {
        const view = result.current.saveView('My View');
        viewId = view.id;
      });
      // Change filters
      act(() => {
        result.current.setFilter('query', 'changed');
      });
      // Load the saved view
      act(() => {
        result.current.loadView(viewId!);
      });
      expect(result.current.filters.query).toBe('test');
      expect(result.current.activeViewId).toBe(viewId!);
    });

    it('should do nothing for unknown view id', () => {
      const { result } = renderHook(() => useSearch({ query: 'test' }));
      act(() => {
        result.current.loadView('nonexistent');
      });
      expect(result.current.filters.query).toBe('test');
    });
  });

  describe('deleteView', () => {
    it('should delete a saved view', () => {
      const { result } = renderHook(() => useSearch({ query: 'test' }));
      let viewId: string;
      act(() => {
        const view = result.current.saveView('My View');
        viewId = view.id;
      });
      act(() => {
        result.current.deleteView(viewId!);
      });
      expect(result.current.savedViews).toHaveLength(0);
    });

    it('should clear active view if deleted view was active', () => {
      const { result } = renderHook(() => useSearch({ query: 'test' }));
      let viewId: string;
      act(() => {
        const view = result.current.saveView('My View');
        viewId = view.id;
      });
      act(() => {
        result.current.deleteView(viewId!);
      });
      expect(result.current.activeViewId).toBeNull();
    });
  });

  describe('updateView', () => {
    it('should update view name and filters', () => {
      const { result } = renderHook(() => useSearch({ query: 'original' }));
      let viewId: string;
      act(() => {
        const view = result.current.saveView('Original Name');
        viewId = view.id;
      });
      act(() => {
        result.current.setFilter('query', 'updated');
      });
      act(() => {
        result.current.updateView(viewId!, 'Updated Name');
      });
      const view = result.current.savedViews.find((v) => v.id === viewId);
      expect(view?.name).toBe('Updated Name');
      expect(view?.filters.query).toBe('updated');
    });
  });

  describe('getShareableUrl', () => {
    it('should return a URL with filter params', () => {
      const { result } = renderHook(() => useSearch({ query: 'test', status: ['active'] }));
      const url = result.current.getShareableUrl();
      expect(url).toContain('q=test');
      expect(url).toContain('status=active');
    });

    it('should return empty string or base URL for no filters', () => {
      const { result } = renderHook(() => useSearch());
      const url = result.current.getShareableUrl();
      // In jsdom, window.location.origin is 'http://localhost'
      // With no filters, params are empty so URL is just origin + pathname
      expect(url).not.toContain('q=');
      expect(url).not.toContain('status=');
    });
  });

  describe('loadFromUrl', () => {
    it('should parse filters from URL search string', () => {
      const { result } = renderHook(() => useSearch());
      act(() => {
        result.current.loadFromUrl('?q=harvest&status=active,paused&priority=high');
      });
      expect(result.current.filters.query).toBe('harvest');
      expect(result.current.filters.status).toEqual(['active', 'paused']);
      expect(result.current.filters.priority).toEqual(['high']);
    });

    it('should clear active view when loading from URL', () => {
      const { result } = renderHook(() => useSearch({ query: 'test' }));
      act(() => {
        result.current.saveView('My View');
      });
      act(() => {
        result.current.loadFromUrl('?q=other');
      });
      expect(result.current.activeViewId).toBeNull();
    });

    it('should handle empty search string', () => {
      const { result } = renderHook(() => useSearch({ query: 'test' }));
      act(() => {
        result.current.loadFromUrl('');
      });
      expect(result.current.filters).toEqual({});
    });
  });
});
