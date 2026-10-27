// Aqua MD for iPhone (sideload build): a full-screen web view running the web version of Aqua MD
// (danii45.github.io/Aqua-MD/app), plus what an app can do that a Home Screen web app can't:
// keep your own songs playing with the screen locked, and hand Spotify links to the Spotify app.
// Built without Xcode project files by ios/build-ipa.sh (swiftc on GitHub's Mac runners).
import UIKit
import WebKit
import AVFoundation

private let desk = UIColor(red: 7 / 255, green: 12 / 255, blue: 23 / 255, alpha: 1)

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // "Playback" lets music keep going with the screen locked (with UIBackgroundModes = audio in Info.plist).
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = desk
        w.rootViewController = DeckViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }
}

final class DeckViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    static let home = URL(string: "https://danii45.github.io/Aqua-MD/app/")!
    /// Sites that open inside the app: Aqua MD itself and Spotify's login (with the sign-in services it offers).
    private static let insideHosts = ["danii45.github.io", "accounts.spotify.com", "challenge.spotify.com", "www.spotify.com",
                                      "accounts.google.com", "appleid.apple.com", "www.facebook.com", "m.facebook.com"]
    private var web: WKWebView!
    private var offline: UILabel!

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.websiteDataStore = .default()
        cfg.applicationNameForUserAgent = "AquaMD-iOS"
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = desk
        web.scrollView.backgroundColor = desk
        web.scrollView.bounces = false
        web.allowsBackForwardNavigationGestures = false
        web.translatesAutoresizingMaskIntoConstraints = false

        offline = UILabel()
        offline.text = "Aqua MD needs the internet to start.\nTap to try again."
        offline.numberOfLines = 0
        offline.textAlignment = .center
        offline.textColor = UIColor(red: 0.62, green: 0.71, blue: 0.84, alpha: 1)
        offline.font = .systemFont(ofSize: 18, weight: .medium)
        offline.isHidden = true
        offline.isUserInteractionEnabled = true
        offline.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(reload)))
        offline.translatesAutoresizingMaskIntoConstraints = false

        let root = UIView()
        root.backgroundColor = desk
        root.addSubview(web)
        root.addSubview(offline)
        let g = root.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: g.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: g.trailingAnchor),
            web.topAnchor.constraint(equalTo: g.topAnchor),
            web.bottomAnchor.constraint(equalTo: g.bottomAnchor),
            offline.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            offline.centerYAnchor.constraint(equalTo: g.centerYAnchor),
            offline.widthAnchor.constraint(lessThanOrEqualTo: g.widthAnchor, constant: -48)
        ])
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        reload()
    }

    @objc private func reload() {
        offline.isHidden = true
        web.isHidden = false
        web.load(URLRequest(url: Self.home, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 20))
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // Aqua MD and Spotify's login stay in the app; Spotify links go to the Spotify app; everything else to Safari.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.allow); return }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "about" || scheme == "blob" || scheme == "data" { decisionHandler(.allow); return }
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        if scheme == "https", let host = url.host?.lowercased(), Self.insideHosts.contains(host) {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        UIApplication.shared.open(url)
    }

    // window.open (the Spotify dashboard, "open in Spotify") leaves the app.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let code = (error as NSError).code
        if code == NSURLErrorCancelled { return }
        if webView.url == nil || webView.url?.host == "danii45.github.io" {
            web.isHidden = true
            offline.isHidden = false
        }
    }

    // iOS can drop the page to save memory while the app is in the background; bring it back.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        reload()
    }
}
