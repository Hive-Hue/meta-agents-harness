import { Link } from "react-router";
import { Icon } from "../ui/Icon";

const navItems = [
  { label: "Overview", icon: "dashboard", path: "/" },
  { label: "Bootstrap", icon: "rocket_launch", path: "/bootstrap" },
  { label: "Config", icon: "tune", path: "/config" },
  { label: "Crews", icon: "groups", path: "/crews" },
  { label: "Run", icon: "play_circle", path: "/run" },
  { label: "Tasks", icon: "checklist", path: "/tasks" },
  { label: "Sessions", icon: "history", path: "/sessions" },
  { label: "Expertise", icon: "psychology", path: "/expertise" },
  { label: "Skills", icon: "extension", path: "/skills" },
  { label: "Context", icon: "database", path: "/context" },
  { label: "Settings", icon: "settings", path: "/settings", pinned: true },
];

type SidebarProps = {
  activeItem: string;
};

export function Sidebar({ activeItem }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Primary navigation">
      {navItems.map((item) => {
        const isActive = item.label === activeItem;

        return (
          <Link
            className={`sidebar__item${isActive ? " sidebar__item--active" : ""}${
              item.pinned ? " sidebar__item--pinned" : ""
            }`}
            to={item.path}
            key={item.label}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon name={item.icon} filled={isActive} />
            <span className="sidebar__label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
