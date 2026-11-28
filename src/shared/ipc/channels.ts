// Section 6.3 lists these channels. prefs:get and prefs:set share a row.
// file:activated and spell:context are main-to-renderer events.
export const IPC_CHANNELS = [
  'file:open',
  'file:save',
  'file:saveAs',
  'file:activated',
  'session:set',
  'export:run',
  'print:run',
  'prefs:get',
  'prefs:set',
  'sig:list',
  'sig:get',
  'sig:save',
  'sig:delete',
  'recovery:put',
  'recovery:list',
  'recovery:restore',
  'recovery:drop',
  'link:open',
  'spell:add',
  'spell:check',
  'spell:suggest',
  'spell:context',
  'clipboard:read',
  'recents:list',
  'recents:open',
] as const;

export type IpcChannelName = (typeof IPC_CHANNELS)[number];

export const IPC_EVENT_CHANNELS = ['file:activated', 'spell:context'] as const;

export type IpcEventChannel = (typeof IPC_EVENT_CHANNELS)[number];

export const IPC_EVENT_CHANNEL = 'file:activated' as const satisfies IpcEventChannel;

export type InvokeChannel = Exclude<IpcChannelName, IpcEventChannel>;

const EVENT_CHANNEL_SET: ReadonlySet<string> = new Set<string>(IPC_EVENT_CHANNELS);

export const IPC_INVOKE_CHANNELS = IPC_CHANNELS.filter(
  (channel): channel is InvokeChannel => !EVENT_CHANNEL_SET.has(channel),
);

export const IPC_DIRECTION = {
  'file:open': 'renderer-to-main',
  'file:save': 'renderer-to-main',
  'file:saveAs': 'renderer-to-main',
  'file:activated': 'main-to-renderer',
  'session:set': 'renderer-to-main',
  'export:run': 'renderer-to-main',
  'print:run': 'renderer-to-main',
  'prefs:get': 'renderer-to-main',
  'prefs:set': 'renderer-to-main',
  'sig:list': 'renderer-to-main',
  'sig:get': 'renderer-to-main',
  'sig:save': 'renderer-to-main',
  'sig:delete': 'renderer-to-main',
  'recovery:put': 'renderer-to-main',
  'recovery:list': 'renderer-to-main',
  'recovery:restore': 'renderer-to-main',
  'recovery:drop': 'renderer-to-main',
  'link:open': 'renderer-to-main',
  'spell:add': 'renderer-to-main',
  'spell:check': 'renderer-to-main',
  'spell:suggest': 'renderer-to-main',
  'spell:context': 'main-to-renderer',
  'clipboard:read': 'renderer-to-main',
  'recents:list': 'renderer-to-main',
  'recents:open': 'renderer-to-main',
} as const satisfies Record<IpcChannelName, 'renderer-to-main' | 'main-to-renderer'>;

const INVOKE_CHANNEL_SET: ReadonlySet<string> = /* @__PURE__ */ new Set(IPC_INVOKE_CHANNELS);

export function isInvokeChannel(channel: string): channel is InvokeChannel {
  return INVOKE_CHANNEL_SET.has(channel);
}
