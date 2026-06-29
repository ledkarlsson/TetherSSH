import { TetherTermApi } from "../shared/ipc";

declare global {
  interface Window {
    tetherTerm: TetherTermApi;
  }
}
