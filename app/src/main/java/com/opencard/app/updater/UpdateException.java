package com.opencard.app.updater;

/** A failure with a category the UI can explain to the player. */
public class UpdateException extends Exception {
    private static final long serialVersionUID = 1L;
    public enum Kind {
        NOT_WIFI, OFFLINE, NOT_FOUND, RATE_LIMITED, NETWORK, BAD_RESPONSE, NO_APK,
        CHECKSUM_MISSING, CHECKSUM_MISMATCH, CORRUPT, WRONG_PACKAGE, NOT_NEWER,
        INCOMPATIBLE, SIGNATURE_MISMATCH, STORAGE, INSTALL_FAILED, CANCELLED
    }

    public final Kind kind;
    /** For RATE_LIMITED: epoch seconds when GitHub allows requests again (0 if unknown). */
    public final long retryAt;

    public UpdateException(Kind kind, String message) {
        this(kind, message, 0, null);
    }

    public UpdateException(Kind kind, String message, Throwable cause) {
        this(kind, message, 0, cause);
    }

    public UpdateException(Kind kind, String message, long retryAt, Throwable cause) {
        super(message, cause);
        this.kind = kind;
        this.retryAt = retryAt;
    }

    /** Whether trying again later might succeed. */
    public boolean retryable() {
        switch (kind) {
            case NOT_WIFI: case OFFLINE: case RATE_LIMITED: case NETWORK: case BAD_RESPONSE:
            case CHECKSUM_MISMATCH: case CORRUPT: case STORAGE: case INSTALL_FAILED: case CANCELLED:
                return true;
            default:
                return false;
        }
    }
}
