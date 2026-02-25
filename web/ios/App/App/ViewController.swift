import UIKit
import Capacitor

class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(StoreKitPlugin())
        bridge?.registerPluginInstance(AppleSignInPlugin())
        bridge?.registerPluginInstance(GDL90Plugin())
        bridge?.registerPluginInstance(RemoteIdPlugin())
    }

    // Extend the web view behind the home indicator (removes black stripe)
    override func viewDidLoad() {
        super.viewDidLoad()
        // Make the web view fill the entire screen, ignoring safe area
        if let webView = self.webView {
            webView.translatesAutoresizingMaskIntoConstraints = true
            webView.frame = view.bounds
            webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            // Ensure content extends behind home indicator
            webView.scrollView.contentInsetAdjustmentBehavior = .never
        }
    }

}
