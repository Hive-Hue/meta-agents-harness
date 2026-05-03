import { Icon } from "../ui/Icon";

const utilityActions = [
  { label: "Console", icon: "terminal" },
  { label: "Docs", icon: "help_outline" },
  { label: "Logout", icon: "logout" },
];

type HeaderBarProps = {
  onConsoleClick?: () => void;
  onLogoutClick?: () => void;
  consoleActive?: boolean;
};

export function HeaderBar({ onConsoleClick, onLogoutClick, consoleActive = false }: HeaderBarProps) {
  return (
    <header className="header-bar">
      <div className="header-bar__brand" aria-label="MAH Operator Console">
        <img
          className="header-bar__logo"
          src="/mah_logo_bg.png"
          alt="MAH"
          height={32}
        />
        <div className="header-bar__brand-copy">
          <h1 className="header-bar__title">Operator Console</h1>
        </div>
      </div>

      <div className="header-bar__tools">
        <label className="header-search">
          <span className="sr-only">Search workspace</span>
          <Icon name="search" className="header-search__icon" />
          <input
            className="header-search__input"
            type="search"
            placeholder="Search workspace, commands, sessions..."
          />
        </label>

        <div className="header-actions" aria-label="Global utilities">
          {utilityActions.map((action) => (
            <button
              className={`header-action${action.label === "Console" && consoleActive ? " header-action--active" : ""}`}
              key={action.label}
              type="button"
              onClick={
                action.label === "Console"
                  ? onConsoleClick
                  : action.label === "Logout"
                    ? onLogoutClick
                    : undefined
              }
            >
              <Icon name={action.icon} size={18} />
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
