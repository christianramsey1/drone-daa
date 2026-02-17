#import <Capacitor/Capacitor.h>

CAP_PLUGIN(AppleSignInPlugin, "SignInWithApple",
    CAP_PLUGIN_METHOD(authorize, CAPPluginReturnPromise);
)
