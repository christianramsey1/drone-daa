#import <Capacitor/Capacitor.h>

CAP_PLUGIN(RemoteIdPlugin, "RemoteId",
    CAP_PLUGIN_METHOD(startScanning, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopScanning, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getSnapshot, CAPPluginReturnPromise);
)
