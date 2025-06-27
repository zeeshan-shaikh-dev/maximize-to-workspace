import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class MaximizeToWorkspaceExtension extends Extension {
  enable() {
    this._windowSignals = new Map();
    this._workspaceMap = new Map();
    this._trackedWindows = new Set();
    this._recentlyMoved = new Map();
    this._startupTime = GLib.get_monotonic_time() / 1000;

    this._trackExistingWindows();

    this._tracker = Shell.WindowTracker.get_default();
    this._trackerId = this._tracker.connect('tracked-windows-changed', () => {
      this._trackExistingWindows();
    });

    log('Maximize-to-workspace: Extension enabled');
  }

  disable() {
    if (this._trackerId && this._tracker) {
      this._tracker.disconnect(this._trackerId);
      this._trackerId = null;
    }
    this._disconnectAll();
    this._recentlyMoved.clear();
    this._workspaceMap.clear();
    log('Maximize-to-workspace: Extension disabled');
  }

  _trackExistingWindows() {
    global.get_window_actors().forEach(actor => {
      const win = actor.meta_window;
      if (!this._trackedWindows.has(win)) {
        this._trackedWindows.add(win);
        this._connectMaximizeSignals(win);
      }
    });
  }

  _connectMaximizeSignals(win) {
    // Cache workspace when first tracking
    if (win && win.get_workspace) {
      this._workspaceMap.set(win, win.get_workspace());
    }

    const handler1 = win.connect('notify::maximized-horizontally', () => this._onMaximizeChange(win));
    const handler2 = win.connect('notify::maximized-vertically', () => this._onMaximizeChange(win));


    this._windowSignals.set(win, [handler1, handler2]);
    log(`Maximize-to-workspace: Tracking window - ${win.get_title() || 'null'}`);
  }

  _disconnectAll() {
    for (const [win, signals] of this._windowSignals.entries()) {
      signals.forEach(signal => win.disconnect(signal));
    }
    this._windowSignals.clear();
    this._trackedWindows.clear();
  }

  _onMaximizeChange(win) {
    if (!win || !(win instanceof Meta.Window)) return;
    if (win.window_type !== Meta.WindowType.NORMAL) return;

    const now = GLib.get_monotonic_time() / 1000;
    const WorkspaceManager = global.workspace_manager;

    if (now - this._startupTime < 3000) return;

    if (win.maximized_horizontally && win.maximized_vertically) {
      const lastTime = this._recentlyMoved.get(win) || 0;
      if (now - lastTime < 1000) return;

      let targetIndex = -1;
      const numWorkspaces = WorkspaceManager.n_workspaces;

      for (let i = 1; i < numWorkspaces + 1; i++) {
        if (i === numWorkspaces) {
          WorkspaceManager.append_new_workspace(false, global.get_current_time());
        }
        const ws = WorkspaceManager.get_workspace_by_index(i);
        const windows = ws.list_windows().filter(w =>
          w.window_type === Meta.WindowType.NORMAL &&
          w.maximized_horizontally && w.maximized_vertically
        );
        if (windows.length === 0) {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex === -1) return;

      const newWorkspace = WorkspaceManager.get_workspace_by_index(targetIndex);
      win.change_workspace(newWorkspace);
      newWorkspace.activate(global.get_current_time());
      this._recentlyMoved.set(win, now);
      this._workspaceMap.set(win, newWorkspace);

      log(`Maximize-to-workspace: Moved "${win.get_title()}" to workspace ${targetIndex}`);
    } else {
      const oldWorkspace = win.get_workspace();
      const oldIndex = oldWorkspace.index();
      const firstWorkspace = WorkspaceManager.get_workspace_by_index(0);

      win.change_workspace(firstWorkspace);
      firstWorkspace.activate(global.get_current_time());

      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
        const remaining = oldWorkspace.list_windows().filter(w =>
          w.window_type === Meta.WindowType.NORMAL && w !== win
        );
        if (remaining.length === 0 && oldIndex !== 0) {
          WorkspaceManager.remove_workspace(oldWorkspace, global.get_current_time());
          log(`Maximize-to-workspace: Removed empty workspace ${oldIndex}`);
        }
        return GLib.SOURCE_REMOVE;
      });
    }
  }
}

