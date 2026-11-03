package com.opencard.app.updater;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

/** Updates only ever use Wi-Fi: never mobile data, never when offline. */
public final class NetworkPolicy {
    private NetworkPolicy() {}

    /**
     * Returns the active network if it is Wi-Fi with internet access, otherwise throws.
     * Automatic checks additionally skip metered Wi-Fi (for example a phone's mobile hotspot).
     */
    public static Network requireWifi(Context ctx, boolean automatic) throws UpdateException {
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        Network n = cm == null ? null : cm.getActiveNetwork();
        NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
        if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            throw new UpdateException(UpdateException.Kind.OFFLINE, "You're offline.");
        }
        if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
            throw new UpdateException(UpdateException.Kind.NOT_WIFI, "Updates are only checked and downloaded over Wi-Fi.");
        }
        if (automatic && !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)) {
            throw new UpdateException(UpdateException.Kind.NOT_WIFI, "This Wi-Fi network is metered.");
        }
        return n;
    }
}
