import Foundation
import Observation
import Abstractions

@MainActor
@Observable
final class FeedViewModel {
    enum State: Equatable {
        case loading
        case loaded([Post])
        case failed(FeedError)
    }

    private let repository: any FeedRepository
    private(set) var state: State = .loading

    init(repository: any FeedRepository) {
        self.repository = repository
    }

    func onAppear() async {
        await load()
    }

    private func load() async {
        do throws(FeedError) {
            state = .loaded(try await repository.posts())
        } catch {
            state = .failed(error)
        }
    }
}
