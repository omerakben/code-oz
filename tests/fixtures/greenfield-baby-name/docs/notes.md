# Notes

This fixture exists to make `glob`/`grep` over an actual on-disk tree feel
realistic when the e2e runs. The real PLAN persona, when wired to a live
provider, would issue tool_use blocks during prompt construction and pull
adjacent patterns into the next manifest. The FakeProvider e2e cannot
exercise that surface; this directory sits here mainly to give the
permission intersector a meaningful project root.
