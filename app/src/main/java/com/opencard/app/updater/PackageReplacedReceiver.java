package com.opencard.app.updater;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After the app has been updated, delete the downloaded installer files. */
public final class PackageReplacedReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            UpdateManager.deleteDownloads(context);
        }
    }
}
