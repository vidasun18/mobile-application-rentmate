import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'state.dart';
import 'strings.dart';
import 'ui.dart';
import 'tour.dart';
import 'profile.dart';
import 'trip_actions.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int index = 0;
  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final nav = switch (state.role) {
      'TOURIST' => ['agents', 'tours', 'alerts', 'profile'],
      'AGENT' => ['dashboard', 'drivers', 'alerts', 'profile'],
      'DRIVER' => ['feed', 'agencies', 'alerts', 'profile'],
      _ => ['verification', 'audit', 'alerts', 'profile'],
    };
    const icons = {
      'agents': Icons.travel_explore,
      'tours': Icons.route_outlined,
      'dashboard': Icons.work_outline,
      'drivers': Icons.people_outline,
      'feed': Icons.directions_car_outlined,
      'agencies': Icons.business_outlined,
      'verification': Icons.verified_user_outlined,
      'audit': Icons.history,
      'alerts': Icons.notifications_outlined,
      'profile': Icons.person_outline,
    };
    final page = nav[index];
    Widget body = switch (page) {
      'agents' || 'agencies' => AgentsPage(driver: state.role == 'DRIVER'),
      'tours' || 'dashboard' || 'feed' => const ToursPage(),
      'drivers' => const MembershipPage(),
      'verification' => const AdminPage(),
      'audit' => const AuditPage(),
      'alerts' => const NotificationsPage(),
      _ => const ProfilePage(),
    };
    if (!state.approved && page != 'profile' && page != 'alerts') {
      body = ListView(
        padding: const EdgeInsets.all(20),
        children: [
          HeroPanel(tr('pendingTitle')),
          const SizedBox(height: 20),
          Text(
            tr(
              state.user!['status'] == 'PENDING'
                  ? 'pendingBody'
                  : 'accountUnavailable',
            ),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: () => setState(() => index = nav.indexOf('profile')),
            child: Text(tr('profile')),
          ),
          OutlinedButton(
            onPressed: () => act(context, state.refreshUser),
            child: Text(tr('checkStatus')),
          ),
        ],
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: Text(tr(page)),
        actions: [
          IconButton(
            tooltip: tr('logout'),
            onPressed: state.logout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 850),
          child: Column(
            children: [
              const OfflineBanner(),
              Expanded(child: body),
            ],
          ),
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (v) => setState(() => index = v),
        destinations: [
          for (final p in nav)
            NavigationDestination(icon: Icon(icons[p]), label: tr(p)),
        ],
      ),
    );
  }
}

class AgentsPage extends StatefulWidget {
  final bool driver;
  const AgentsPage({super.key, this.driver = false});
  @override
  State<AgentsPage> createState() => _AgentsPageState();
}

class _AgentsPageState extends State<AgentsPage> {
  String search = '';
  int version = 0;
  @override
  Widget build(BuildContext context) {
    final api = context.read<AppState>();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: TextField(
            decoration: InputDecoration(
              hintText: tr('search'),
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(
                onPressed: () => setState(() => version++),
                icon: const Icon(Icons.arrow_forward),
              ),
            ),
            onSubmitted: (s) => setState(() {
              search = s;
              version++;
            }),
            onChanged: (s) => search = s,
          ),
        ),
        Expanded(
          child: RemoteList(
            key: ValueKey(version),
            load: () async =>
                (await api.request(
                          '/agents?search=${Uri.encodeQueryComponent(search)}',
                        )
                        as List)
                    .cast<Json>(),
            empty: tr('emptyAgents'),
            header: HeroPanel(
              tr(widget.driver ? 'findAgency' : 'findAgent'),
              subtitle: '${tr('welcome')}, ${api.user!['name']}',
            ),
            item: (a, reload) => SectionCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  PersonCard({...a, 'name': a['agency_name']}),
                  const SizedBox(height: 8),
                  Text(a['location'] ?? ''),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: api.offline
                          ? null
                          : () async {
                              if (widget.driver) {
                                await act(
                                  context,
                                  () => api.request(
                                    '/agencies/${a['id']}/apply',
                                    method: 'POST',
                                  ),
                                );
                              } else {
                                await requestTour(context, a);
                              }
                            },
                      child: Text(tr(widget.driver ? 'apply' : 'requestTour')),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        if (widget.driver)
          Padding(
            padding: const EdgeInsets.all(8),
            child: OutlinedButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => Scaffold(
                    appBar: AppBar(title: Text(tr('agencies'))),
                    body: const MembershipPage(),
                  ),
                ),
              ),
              child: Text(tr('applicationSent')),
            ),
          ),
      ],
    );
  }
}

Future<void> requestTour(BuildContext context, Json agent) async {
  final api = context.read<AppState>();
  await formPage(
    context,
    tr('sendRequest'),
    [
      const FieldSpec('pickup', 'from'),
      const FieldSpec('destination', 'to'),
      const FieldSpec('starts_at', 'startsAt', type: 'datetime'),
      const FieldSpec('ends_at', 'endsAt', type: 'datetime'),
      const FieldSpec(
        'vehicle_type',
        'vehicleType',
        initial: 'CAR',
        options: {'CAR': 'car', 'VAN': 'van', 'KDH': 'kdh'},
      ),
      const FieldSpec(
        'passengers',
        'passengers',
        type: 'integer',
        initial: '1',
      ),
      const FieldSpec('notes', 'notes', type: 'multiline', optional: true),
    ],
    help: '${tr('bookedWith')} ${agent['agency_name']}. ${tr('agentControl')}',
    submit: (b) async {
      await api.request(
        '/tours',
        method: 'POST',
        body: {...b, 'agent_id': agent['id']},
      );
    },
  );
}

class ToursPage extends StatefulWidget {
  const ToursPage({super.key});
  @override
  State<ToursPage> createState() => _ToursPageState();
}

class _ToursPageState extends State<ToursPage> {
  Json stats = {};
  String agency = 'all';
  String filter = 'all';
  int version = 0;
  @override
  Widget build(BuildContext context) {
    final api = context.read<AppState>();
    return Column(
      children: [
        SizedBox(
          height: 52,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: [
              for (final s in [
                'all',
                'REQUESTED',
                'QUOTED',
                'ACCEPTED',
                'OPEN',
                'ASSIGNED',
                'IN_PROGRESS',
                'COMPLETED',
                'CANCELLED',
              ])
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(tr(s)),
                    selected: filter == s,
                    onSelected: (_) => setState(() => filter = s),
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: RemoteList(
            key: ValueKey(version),
            load: () async {
              final rows = await api.tours();
              if (api.role == 'AGENT' && !api.offline) {
                stats = Map<String, dynamic>.from(
                  await api.request('/me/dashboard'),
                );
              }
              return rows;
            },
            headerBuilder: (rows) => api.role == 'DRIVER'
                ? DropdownButtonFormField<String>(
                    initialValue: rows.any((t) => t['agent_id'] == agency)
                        ? agency
                        : 'all',
                    decoration: InputDecoration(labelText: tr('agencies')),
                    items: [
                      DropdownMenuItem(
                        value: 'all',
                        child: Text(tr('allAgencies')),
                      ),
                      for (final entry in {
                        for (final row in rows)
                          if (row['agent_id'] != null)
                            row['agent_id']: row['agency_name'] ?? '',
                      }.entries)
                        DropdownMenuItem(
                          value: entry.key,
                          child: Text(entry.value),
                        ),
                    ],
                    onChanged: (value) =>
                        setState(() => agency = value ?? 'all'),
                  )
                : api.role != 'AGENT' || stats.isEmpty
                ? const SizedBox.shrink()
                : Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      for (final s in [
                        'REQUESTED',
                        'QUOTED',
                        'ACCEPTED',
                        'OPEN',
                        'ASSIGNED',
                        'IN_PROGRESS',
                        'COMPLETED',
                        'CANCELLED',
                      ])
                        Chip(
                          label: Text('${stats['tours']?[s] ?? 0} ${tr(s)}'),
                        ),
                      Chip(
                        label: Text(
                          '${stats['applications'] ?? 0} ${tr('applications')}',
                        ),
                      ),
                      Chip(
                        label: Text(
                          '${stats['unread_notifications'] ?? 0} ${tr('unread')}',
                        ),
                      ),
                    ],
                  ),
            empty: tr('emptyTours'),
            header: HeroPanel(
              tr(
                api.role == 'DRIVER'
                    ? 'matchingTours'
                    : api.role == 'AGENT'
                    ? 'dashboard'
                    : 'tours',
              ),
              subtitle: '${tr('welcome')}, ${api.user!['name']}',
            ),
            item: (t, reload) {
              if (filter != 'all' && filter != t['status'] ||
                  api.role == 'DRIVER' &&
                      agency != 'all' &&
                      t['agent_id'] != agency) {
                return const SizedBox.shrink();
              }
              return Card(
                child: InkWell(
                  borderRadius: BorderRadius.circular(20),
                  onTap: () async {
                    if (api.offline) {
                      await Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => OfflineTripPage(tour: t),
                        ),
                      );
                      return;
                    }
                    await Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => TourPage(id: t['id'])),
                    );
                    reload();
                  },
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                '${t['pickup']} → ${t['destination']}',
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                            ),
                            StatusChip(t['status']),
                          ],
                        ),
                        Text(date(t['starts_at'])),
                        if (t['agency_name'] != null) Text(t['agency_name']),
                        const SizedBox(height: 10),
                        Text(
                          '${t['vehicle_type']} · ${t['passengers']} ${tr('passengers')}',
                        ),
                        if (t['payout_minor'] != null && api.role == 'DRIVER')
                          Padding(
                            padding: const EdgeInsets.only(top: 12),
                            child: Text(
                              money(t['payout_minor']),
                              style: const TextStyle(
                                color: teal,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        if (t['quote'] != null && api.role != 'DRIVER')
                          Padding(
                            padding: const EdgeInsets.only(top: 12),
                            child: Text(
                              money(t['quote']['total_minor']),
                              style: const TextStyle(
                                color: teal,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        if (t['is_taken'] == true && t['is_assigned'] != true)
                          Text(tr('taken')),
                        if (api.role == 'DRIVER' &&
                            t['status'] == 'OPEN' &&
                            !api.offline)
                          Padding(
                            padding: const EdgeInsets.only(top: 12),
                            child: InterestButton(tour: t, reload: reload),
                          ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class MembershipPage extends StatelessWidget {
  const MembershipPage({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.read<AppState>();
    return RemoteList(
      load: () async =>
          (await api.request('/agencies/members') as List).cast<Json>(),
      item: (m, reload) => SectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            PersonCard({
              ...m['profile'],
              if (m['profile']['agency_name'] != null)
                'name': m['profile']['agency_name'],
            }),
            for (final vehicle in (m['profile']['vehicles'] as List? ?? []))
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${vehicle['model']} · ${vehicle['registration']} · ${vehicle['seats']} ${tr('seats')}',
                    ),
                    StatusChip(vehicle['approved'] ? 'APPROVED' : 'PENDING'),
                    if ((vehicle['photos'] as List? ?? []).isNotEmpty)
                      SizedBox(
                        height: 100,
                        child: ListView(
                          scrollDirection: Axis.horizontal,
                          children: [
                            for (final photo in vehicle['photos'])
                              Padding(
                                padding: const EdgeInsets.only(right: 8),
                                child: Image.network(
                                  photo['url'],
                                  width: 130,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, e, s) =>
                                      Text(tr('imageFailed')),
                                ),
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            StatusChip(m['status']),
            if (api.role == 'AGENT')
              Wrap(
                spacing: 10,
                children: [
                  for (final s
                      in m['status'] == 'PENDING'
                          ? ['ACCEPTED', 'REJECTED']
                          : m['status'] == 'ACCEPTED'
                          ? ['REMOVED']
                          : <String>[])
                    OutlinedButton(
                      onPressed: () async {
                        await act(
                          context,
                          () => api.request(
                            '/agencies/members/${m['id']}',
                            method: 'PATCH',
                            body: {'status': s},
                          ),
                        );
                        reload();
                      },
                      child: Text(
                        tr(
                          s == 'ACCEPTED'
                              ? 'accept'
                              : s == 'REJECTED'
                              ? 'reject'
                              : 'remove',
                        ),
                      ),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class NotificationsPage extends StatelessWidget {
  const NotificationsPage({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.read<AppState>();
    return RemoteList(
      load: () async =>
          (await api.request('/notifications') as List).cast<Json>(),
      empty: tr('emptyAlerts'),
      header: !api.pushAvailable
          ? Padding(
              padding: const EdgeInsets.all(12),
              child: Text(tr('notificationsUnavailable')),
            )
          : null,
      item: (n, reload) => Card(
        child: ListTile(
          leading: Icon(
            n['read_at'] == null
                ? Icons.notifications_active_outlined
                : Icons.notifications_none,
            color: teal,
          ),
          title: Text(n['title']),
          subtitle: Text(date(n['created_at'])),
          onTap: () async {
            await act(
              context,
              () => api.request('/notifications/${n['id']}', method: 'PATCH'),
            );
            reload();
            if (context.mounted) await openNotification(context, n);
          },
        ),
      ),
    );
  }
}

Future<void> openNotification(BuildContext context, Json notification) async {
  final api = context.read<AppState>();
  if (api.user == null) return;
  final kind = notification['resource_kind'];
  if (kind == 'TOUR' &&
      notification['resource_id'] != null &&
      api.role != 'ADMIN') {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => TourPage(id: notification['resource_id']),
      ),
    );
  } else if (kind == 'MEMBERSHIP' && ['AGENT', 'DRIVER'].contains(api.role)) {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => Scaffold(
          appBar: AppBar(
            title: Text(tr(api.role == 'AGENT' ? 'drivers' : 'agencies')),
          ),
          body: const MembershipPage(),
        ),
      ),
    );
  } else if (kind == 'ACCOUNT') {
    await act(context, api.refreshUser);
    if (context.mounted && api.user != null) {
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => Scaffold(
            appBar: AppBar(title: Text(tr('profile'))),
            body: const ProfilePage(),
          ),
        ),
      );
    }
  }
}
