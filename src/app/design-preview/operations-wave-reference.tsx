import { OperationsWaveDetailed } from "./operations-wave-detailed";

type Props = { screen: string; action: (label: string) => void };

export function OperationsWaveReference({ screen, action }: Props) {
  return <OperationsWaveDetailed screen={screen} action={action}/>;
}
