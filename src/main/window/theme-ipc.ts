import { invalidArgument, senderNotAllowed, unknownChannel, type IpcErrorResult } from '../../shared/ipc/errors.js';
import {
  THEME_GET_CHANNEL,
  isThemeChannel,
  themeGetOk,
  type ThemeGetOk,
  type ThemeSetting,
} from '../../shared/theme.js';
import { isAppPageSender } from '../ipc/sender.js';

export interface ThemeCall {
  senderUrl: string | null;
  channel: string;
  args: readonly unknown[];
}

export function dispatchThemeGet(call: ThemeCall, theme: ThemeSetting): ThemeGetOk | IpcErrorResult {
  if (!isAppPageSender(call.senderUrl)) {
    return senderNotAllowed();
  }
  if (!isThemeChannel(call.channel) || call.channel !== THEME_GET_CHANNEL) {
    return unknownChannel();
  }
  if (call.args.length !== 0) {
    return invalidArgument(THEME_GET_CHANNEL);
  }
  return themeGetOk(theme);
}
