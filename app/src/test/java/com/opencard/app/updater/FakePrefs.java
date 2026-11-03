package com.opencard.app.updater;

import android.content.SharedPreferences;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** In-memory SharedPreferences for JVM tests. */
final class FakePrefs implements SharedPreferences {
    final Map<String, Object> m = new HashMap<>();

    @Override public Map<String, ?> getAll() { return m; }
    @Override public String getString(String k, String d) { return m.containsKey(k) ? (String) m.get(k) : d; }
    @Override @SuppressWarnings("unchecked") public Set<String> getStringSet(String k, Set<String> d) { return m.containsKey(k) ? (Set<String>) m.get(k) : d; }
    @Override public int getInt(String k, int d) { return m.containsKey(k) ? (Integer) m.get(k) : d; }
    @Override public long getLong(String k, long d) { return m.containsKey(k) ? (Long) m.get(k) : d; }
    @Override public float getFloat(String k, float d) { return m.containsKey(k) ? (Float) m.get(k) : d; }
    @Override public boolean getBoolean(String k, boolean d) { return m.containsKey(k) ? (Boolean) m.get(k) : d; }
    @Override public boolean contains(String k) { return m.containsKey(k); }
    @Override public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) { }
    @Override public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) { }

    @Override
    public Editor edit() {
        return new Editor() {
            final Map<String, Object> pending = new HashMap<>();
            @Override public Editor putString(String k, String v) { pending.put(k, v); return this; }
            @Override public Editor putStringSet(String k, Set<String> v) { pending.put(k, v); return this; }
            @Override public Editor putInt(String k, int v) { pending.put(k, v); return this; }
            @Override public Editor putLong(String k, long v) { pending.put(k, v); return this; }
            @Override public Editor putFloat(String k, float v) { pending.put(k, v); return this; }
            @Override public Editor putBoolean(String k, boolean v) { pending.put(k, v); return this; }
            @Override public Editor remove(String k) { pending.put(k, null); return this; }
            @Override public Editor clear() { m.clear(); return this; }
            @Override public boolean commit() { apply(); return true; }
            @Override public void apply() {
                for (Map.Entry<String, Object> e : pending.entrySet()) {
                    if (e.getValue() == null) m.remove(e.getKey()); else m.put(e.getKey(), e.getValue());
                }
            }
        };
    }
}
