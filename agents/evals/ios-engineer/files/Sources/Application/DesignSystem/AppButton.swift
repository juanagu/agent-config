import SwiftUI

public enum AppButtonStyle: Sendable {
    case primary
    case secondary
}

public struct AppButton: View {
    private let title: LocalizedStringKey
    private let style: AppButtonStyle
    private let action: () -> Void

    public init(_ title: LocalizedStringKey, style: AppButtonStyle = .primary, action: @escaping () -> Void) {
        self.title = title
        self.style = style
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Text(title)
                .font(Typography.body)
                .frame(maxWidth: .infinity, minHeight: Spacing.control)
        }
        .foregroundStyle(style == .primary ? Palette.onAccent : Palette.ink)
        .background(style == .primary ? Palette.accent : Palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: Radius.medium))
    }
}
