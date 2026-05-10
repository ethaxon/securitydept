set dotenv-load
set windows-shell := ["pwsh.exe", "-NoLogo", "-ExecutionPolicy", "RemoteSigned", "-Command"]

import "justfiles/setup.just"
import "justfiles/dev.just"
import "justfiles/build.just"
import "justfiles/quality.just"
import "justfiles/release.just"
import "justfiles/test.just"
import "justfiles/tools.just"
