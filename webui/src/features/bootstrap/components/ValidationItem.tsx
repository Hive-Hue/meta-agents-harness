import { Icon } from "../../../components/ui/Icon";

type ValidationItemProps = {
  status: "check" | "warning" | "info";
  text: string;
};

const statusIcons: Record<ValidationItemProps["status"], string> = {
  check: "check_circle",
  warning: "warning",
  info: "info",
};

export function ValidationItem({ status, text }: ValidationItemProps) {
  return (
    <li className={"validation-item validation-item--" + status}>
      <Icon name={statusIcons[status]} size={16} />
      <span>{text}</span>
    </li>
  );
}
