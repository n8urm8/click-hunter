import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function useStartBossFight() {
  return useMutation(api.bossFights.startBossFight);
}

export function useStrikeBoss() {
  return useMutation(api.bossFights.strikeBoss);
}

export function useCheckBossFight() {
  return useMutation(api.bossFights.checkBossFight);
}
