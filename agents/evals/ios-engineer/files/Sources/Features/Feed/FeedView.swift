import SwiftUI
import Application
import Abstractions

struct FeedView: View {
    let viewModel: FeedViewModel

    var body: some View {
        ScreenShell(title: "feed.title") {
            switch viewModel.state {
            case .loading:
                ProgressView()
            case .loaded(let posts):
                List(posts) { post in
                    Text(post.title)
                }
            case .failed:
                Text("feed.error")
                    .foregroundStyle(Palette.mutedInk)
            }
        }
        .task { await viewModel.onAppear() }
    }
}
