import { Icon } from "../ui/Icon";

const utilityActions = [
  { label: "Console", icon: "terminal" },
  { label: "Settings", icon: "settings" },
  { label: "Docs", icon: "help_outline" },
];

export function HeaderBar() {
  return (
    <header className="header-bar">
      <div className="header-bar__brand" aria-label="MAH Operator Console">
        <img                                                                                                                
          className="header-bar__logo"                                                                                      
          src="/mah_logo_bg.png"                                                                                            
          alt="MAH"                                                                                                         
          height={32}                                                                                                       
        />
        <h1 className="header-bar__title">Operator Console</h1>
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
            <button className="header-action" key={action.label} type="button">
              <Icon name={action.icon} size={20} />
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
