const PuzzleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

const HamburgerIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const TAB_ITEMS = [
  {
    id: 'extensions',
    label: 'Extensions',
    icon: null, // resolved dynamically based on active state
  },
  {
    id: 'editor',
    label: 'Editor',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="16" y2="17" />
      </svg>
    ),
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
  {
    id: 'ai-chat',
    label: 'AI Chat',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
];

export default function Layout({ activeTab, onTabChange, children }) {
  return (
    <div className="flex flex-col h-full">
      {/* Main content area */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>

      {/* Bottom Navigation Bar — glassmorphism, iOS safe area */}
      <nav
        className="flex shrink-0"
        style={{
          backgroundColor: 'rgba(30, 30, 30, 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {TAB_ITEMS.map((tab) => {
          const isActive = activeTab === tab.id;
          let icon = tab.icon;
          if (tab.id === 'extensions') {
            icon = isActive ? <HamburgerIcon /> : <PuzzleIcon />;
          }
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] transition-colors cursor-pointer border-none outline-none ${
                isActive
                  ? 'text-vscode-accent'
                  : 'text-vscode-text-muted hover:text-vscode-text'
              }`}
              style={{ backgroundColor: 'transparent' }}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              {icon}
              <span className="text-[10px] leading-tight">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
