package com.opencard.app.updater;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Receives PackageInstaller status updates for the update session. */
public final class InstallResultReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (ApkInstaller.ACTION_STATUS.equals(intent.getAction())) {
            UpdateManager.get(context).onInstallStatus(intent);
        }
    }
}
