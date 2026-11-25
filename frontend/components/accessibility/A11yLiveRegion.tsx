import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type AnnouncementPoliteness = 'polite' | 'assertive';

interface A11yLiveRegionContextType {
  announce: (message: string, politeness?: AnnouncementPoliteness) => void;
}

const A11yLiveRegionContext = createContext<A11yLiveRegionContextType | undefined>(
  undefined,
);

export const A11yLiveRegionProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [announcement, setAnnouncement] = useState<{
    message: string;
    politeness: AnnouncementPoliteness;
  }>({ message: '', politeness: 'polite' });

  const announce = useCallback(
    (message: string, politeness: AnnouncementPoliteness = 'polite') => {
      setAnnouncement({ message, politeness });
    },
    [],
  );

  return (
    <A11yLiveRegionContext.Provider value={{ announce }}>
      {children}
      {/* Off-screen live regions for screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement.politeness === 'polite' ? announcement.message : ''}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement.politeness === 'assertive' ? announcement.message : ''}
      </div>
    </A11yLiveRegionContext.Provider>
  );
};

export const useA11yAnnouncer = () => {
  const context = useContext(A11yLiveRegionContext);
  if (!context) {
    throw new Error('useA11yAnnouncer must be used within A11yLiveRegionProvider');
  }
  return context;
};