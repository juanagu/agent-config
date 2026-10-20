import SwiftUI
import Application

struct AccountView: View {
    let viewModel: AccountViewModel
    let onSignOut: () -> Void

    var body: some View {
        ScreenShell(title: "account.title") {
            VStack(spacing: Spacing.medium) {
                AppButton("account.signOut", style: .secondary, action: onSignOut)
                Button("account.deleteAccount") {
                    viewModel.deleteAccountTapped()
                }
            }
            .padding(Spacing.medium)
        }
    }
}
