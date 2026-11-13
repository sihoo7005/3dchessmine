from django.http import Http404

class CloudflarePublicHost:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.META.get('HTTP_X_CHESSMINE_PAGES') == '1':
            request.META['HTTP_HOST'] = '3dchessmine.pages.dev'
        return self.get_response(request)

class GoogleOnlyAccountRoutes:
    """Keep password/account-management routes unavailable; this service uses Google only."""
    allowed = {'/chessmine/accounts/google/login/', '/chessmine/accounts/google/login/callback/',
               '/chessmine/accounts/3rdparty/login/cancelled/', '/chessmine/accounts/3rdparty/login/error/'}
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/chessmine/accounts/') and request.path not in self.allowed:
            raise Http404
        return self.get_response(request)
