#import <Capacitor/Capacitor.h>

CAP_PLUGIN(GDL90Plugin, "GDL90",
    CAP_PLUGIN_METHOD(startListening, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopListening, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getSnapshot, CAPPluginReturnPromise);
)
