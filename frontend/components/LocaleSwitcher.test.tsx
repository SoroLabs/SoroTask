import { fireEvent, render, screen } from '@testing-library/react';
import LocaleSwitcher from './LocaleSwitcher';
import { LocaleProvider } from '@/context/LocaleContext';

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('offers all eight required locales and persists a selection', () => {
    render(
      <LocaleProvider defaultLocale="en">
        <LocaleSwitcher compact={false} />
      </LocaleProvider>,
    );

    expect(screen.getAllByRole('button')).toHaveLength(8);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to العربية' }));

    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(window.localStorage.getItem('sorotask_locale')).toBe('ar');
  });

  it('renders an accessible compact locale selector', () => {
    render(
      <LocaleProvider defaultLocale="en">
        <LocaleSwitcher compact showLabel={false} />
      </LocaleProvider>,
    );

    expect(screen.getByRole('combobox', { name: 'Select language' })).toBeInTheDocument();
  });
});
