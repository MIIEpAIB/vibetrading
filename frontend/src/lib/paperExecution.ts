export type PaperExecutionMode = "shadow" | "broker_paper";

export const PAPER_EXECUTION_OPTIONS: Array<{
  mode: PaperExecutionMode;
  profileId: string;
  label: string;
  description: string;
}> = [
  {
    mode: "shadow",
    profileId: "",
    label: "Internal shadow",
    description: "In-memory virtual ledger",
  },
  {
    mode: "broker_paper",
    profileId: "binance-paper-trade",
    label: "Binance testnet",
    description: "Broker-side paper order",
  },
  {
    mode: "broker_paper",
    profileId: "okx-paper-trade",
    label: "OKX demo",
    description: "Broker-side paper order",
  },
  {
    mode: "broker_paper",
    profileId: "alpaca-paper-trade",
    label: "Alpaca paper",
    description: "Broker-side paper order",
  },
  {
    mode: "broker_paper",
    profileId: "futu-paper-trade",
    label: "Futu paper",
    description: "Broker-side paper order",
  },
];

export function paperExecutionPayload(selection: string): {
  execution_mode: PaperExecutionMode;
  connector_profile_id?: string;
} {
  const option = PAPER_EXECUTION_OPTIONS.find((item) => executionOptionValue(item) === selection) ?? PAPER_EXECUTION_OPTIONS[0];
  return option.mode === "broker_paper"
    ? { execution_mode: option.mode, connector_profile_id: option.profileId }
    : { execution_mode: "shadow" };
}

export function executionOptionValue(option: { mode: PaperExecutionMode; profileId: string }): string {
  return option.mode === "broker_paper" ? option.profileId : "shadow";
}

export function executionLabel(mode?: string, profileId?: string): string {
  if (mode !== "broker_paper") return "Internal shadow";
  const option = PAPER_EXECUTION_OPTIONS.find((item) => item.profileId === profileId);
  return option?.label ?? profileId ?? "Broker paper";
}
