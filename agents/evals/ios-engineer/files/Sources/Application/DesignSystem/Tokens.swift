import SwiftUI

public enum Palette {
    public static let ink = Color("ink", bundle: .module)
    public static let surface = Color("surface", bundle: .module)
    public static let accent = Color("accent", bundle: .module)
    public static let onAccent = Color("onAccent", bundle: .module)
    public static let mutedInk = Color("mutedInk", bundle: .module)
}

public enum Spacing {
    public static let small: CGFloat = 8
    public static let medium: CGFloat = 16
    public static let large: CGFloat = 24
    public static let control: CGFloat = 48
}

public enum Radius {
    public static let medium: CGFloat = 10
}

public enum Typography {
    public static let body = Font.system(.body)
    public static let caption = Font.system(.caption)
}
