// Compatibility shim for gexiv2 0.16+ on macOS.
// gexiv2 0.16 removed gexiv2_metadata_free() in favor of g_object_unref().
// The rexiv2 crate (via gexiv2-sys 1.4.0) still references the old symbol.
// This shim provides it so the linker succeeds on both old and new gexiv2.
#include <glib-object.h>

void gexiv2_metadata_free(void *metadata) {
    if (metadata) {
        g_object_unref(metadata);
    }
}
